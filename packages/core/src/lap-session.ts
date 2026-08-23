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

function signedArea(
  point: TrackVector3,
  start: TrackVector3,
  finish: TrackVector3,
): number {
  return (point[0] - finish[0]) * (start[2] - finish[2])
    - (start[0] - finish[0]) * (point[2] - finish[2]);
}

function pointInTriangle(point: TrackVector3, triangle: TrackTriangle): boolean {
  const [first, second, third] = triangle;
  const areaA = signedArea(point, first, second);
  const areaB = signedArea(point, second, third);
  const areaC = signedArea(point, third, first);
  const epsilon = 1e-5;
  const hasNegative = areaA < -epsilon || areaB < -epsilon || areaC < -epsilon;
  const hasPositive = areaA > epsilon || areaB > epsilon || areaC > epsilon;
  return !(hasNegative && hasPositive);
}

function contains(checkpoint: LapCheckpoint, point: TrackVector3): boolean {
  return checkpoint.triangles.some((triangle) => pointInTriangle(point, triangle));
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

  update(position: TrackVector3): LapUpdate {
    const checkpoint = this.#course.checkpoints[this.#expectedIndex]!;
    if (!contains(checkpoint, position)) {
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
