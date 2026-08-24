export type TrackVector3 = readonly [number, number, number];

export type TrackTriangle = readonly [TrackVector3, TrackVector3, TrackVector3];

export interface LapCheckpoint {
  id: number;
  center: TrackVector3;
  triangles: readonly TrackTriangle[];
}

export interface LapCourseDefinition {
  checkpoints: readonly LapCheckpoint[];
  splitCheckpointIds?: readonly number[];
}

export interface LapProgress {
  completedLaps: number;
  passedCheckpoints: number;
  totalCheckpoints: number;
  nextCheckpointId: number;
  sectorIndex: number;
}

export interface LapUpdate {
  checkpointPassed: number | null;
  splitPassed: number | null;
  lapCompleted: boolean;
}

const CHECKPOINT_PLANE_TOLERANCE_METERS = 0.25;

function subtract(left: TrackVector3, right: TrackVector3): TrackVector3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(left: TrackVector3, right: TrackVector3): TrackVector3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: TrackVector3, right: TrackVector3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function pointNearTriangle(point: TrackVector3, triangle: TrackTriangle): boolean {
  const edgeA = subtract(triangle[1], triangle[0]);
  const edgeB = subtract(triangle[2], triangle[0]);
  const normal = cross(edgeA, edgeB);
  const normalLength = Math.sqrt(dot(normal, normal));
  const epsilon = 1e-7;
  if (normalLength < epsilon) {
    return false;
  }

  const unitNormal: TrackVector3 = [
    normal[0] / normalLength,
    normal[1] / normalLength,
    normal[2] / normalLength,
  ];
  const fromVertex = subtract(point, triangle[0]);
  const planeDistance = dot(fromVertex, unitNormal);
  if (Math.abs(planeDistance) > CHECKPOINT_PLANE_TOLERANCE_METERS) {
    return false;
  }

  const projected: TrackVector3 = [
    point[0] - unitNormal[0] * planeDistance,
    point[1] - unitNormal[1] * planeDistance,
    point[2] - unitNormal[2] * planeDistance,
  ];
  const projectedOffset = subtract(projected, triangle[0]);
  const edgeADot = dot(edgeA, edgeA);
  const edgeBDot = dot(edgeB, edgeB);
  const edgeABDot = dot(edgeA, edgeB);
  const offsetADot = dot(projectedOffset, edgeA);
  const offsetBDot = dot(projectedOffset, edgeB);
  const denominator = edgeADot * edgeBDot - edgeABDot * edgeABDot;
  if (Math.abs(denominator) < epsilon) {
    return false;
  }

  const u = (edgeBDot * offsetADot - edgeABDot * offsetBDot) / denominator;
  const v = (edgeADot * offsetBDot - edgeABDot * offsetADot) / denominator;
  return u >= -epsilon && v >= -epsilon && u + v <= 1 + epsilon;
}

function contains(checkpoint: LapCheckpoint, point: TrackVector3): boolean {
  return checkpoint.triangles.some((triangle) => pointNearTriangle(point, triangle));
}

function segmentIntersectsTriangle(
  start: TrackVector3,
  finish: TrackVector3,
  triangle: TrackTriangle,
): boolean {
  const direction = subtract(finish, start);
  const edgeA = subtract(triangle[1], triangle[0]);
  const edgeB = subtract(triangle[2], triangle[0]);
  const perpendicular = cross(direction, edgeB);
  const determinant = dot(edgeA, perpendicular);
  const epsilon = 1e-7;
  if (Math.abs(determinant) < epsilon) {
    return false;
  }
  const inverse = 1 / determinant;
  const fromVertex = subtract(start, triangle[0]);
  const u = inverse * dot(fromVertex, perpendicular);
  if (u < -epsilon || u > 1 + epsilon) {
    return false;
  }
  const side = cross(fromVertex, edgeA);
  const v = inverse * dot(direction, side);
  if (v < -epsilon || u + v > 1 + epsilon) {
    return false;
  }
  const distanceAlongSegment = inverse * dot(edgeB, side);
  return distanceAlongSegment >= -epsilon && distanceAlongSegment <= 1 + epsilon;
}

function crosses(
  checkpoint: LapCheckpoint,
  previous: TrackVector3,
  current: TrackVector3,
): boolean {
  return checkpoint.triangles.some((triangle) => (
    segmentIntersectsTriangle(previous, current, triangle)
  ));
}

/** Ordered checkpoint tracker. A lap starts inside checkpoint 0 and completes on returning to it. */
export class LapSession {
  readonly #course: LapCourseDefinition;
  readonly #splitCheckpointIds: Set<number>;
  #completedLaps = 0;
  #expectedIndex = 1;
  #passedCheckpoints = 0;
  #sectorIndex = 0;

  constructor(course: LapCourseDefinition) {
    if (course.checkpoints.length < 2) {
      throw new Error("A lap course needs at least two checkpoints");
    }
    const ids = new Set<number>();
    for (const checkpoint of course.checkpoints) {
      if (!Number.isInteger(checkpoint.id) || ids.has(checkpoint.id)) {
        throw new Error(`Lap checkpoint id ${checkpoint.id} is invalid or duplicated`);
      }
      if (checkpoint.triangles.length === 0) {
        throw new Error(`Lap checkpoint ${checkpoint.id} has no triangles`);
      }
      ids.add(checkpoint.id);
    }
    this.#course = course;
    this.#splitCheckpointIds = new Set(course.splitCheckpointIds ?? []);
    for (const splitId of this.#splitCheckpointIds) {
      if (!ids.has(splitId)) {
        throw new Error(`Lap split ${splitId} does not reference a checkpoint`);
      }
    }
  }

  get progress(): LapProgress {
    return {
      completedLaps: this.#completedLaps,
      passedCheckpoints: this.#passedCheckpoints,
      totalCheckpoints: this.#course.checkpoints.length,
      nextCheckpointId: this.#course.checkpoints[this.#expectedIndex]!.id,
      sectorIndex: this.#sectorIndex,
    };
  }

  reset(): void {
    this.#completedLaps = 0;
    this.#expectedIndex = 1;
    this.#passedCheckpoints = 0;
    this.#sectorIndex = 0;
  }

  update(position: TrackVector3, previousPosition: TrackVector3 = position): LapUpdate {
    const checkpoint = this.#course.checkpoints[this.#expectedIndex]!;
    if (!contains(checkpoint, position) && !crosses(checkpoint, previousPosition, position)) {
      return { checkpointPassed: null, splitPassed: null, lapCompleted: false };
    }

    const checkpointPassed = checkpoint.id;
    const splitPassed = this.#splitCheckpointIds.has(checkpointPassed) ? checkpointPassed : null;
    if (splitPassed !== null) {
      this.#sectorIndex += 1;
    }

    if (this.#expectedIndex === 0) {
      this.#completedLaps += 1;
      this.#expectedIndex = 1;
      this.#passedCheckpoints = 0;
      this.#sectorIndex = 0;
      return { checkpointPassed, splitPassed, lapCompleted: true };
    }

    this.#passedCheckpoints = this.#expectedIndex;
    this.#expectedIndex = (this.#expectedIndex + 1) % this.#course.checkpoints.length;
    return { checkpointPassed, splitPassed, lapCompleted: false };
  }
}
