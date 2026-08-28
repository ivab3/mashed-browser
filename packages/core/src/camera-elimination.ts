import type { TrackVector3 } from "./lap-session.js";

export interface CameraEliminationSubject {
  id: string;
  position: TrackVector3;
  completedLaps: number;
  passedCheckpoints: number;
  distanceToNextCheckpointMeters: number;
}

export interface CameraEliminationConfig {
  maximumDistanceFromLeaderMeters: number;
  maximumDistanceFromCenterMeters: number;
  graceSeconds: number;
}

export interface CameraEliminationWarning {
  playerId: string;
  secondsRemaining: number;
  distanceFromLeaderMeters: number;
  distanceFromCenterMeters: number;
}

export interface CameraEliminationUpdate {
  leaderId: string | null;
  warnings: readonly CameraEliminationWarning[];
  eliminatedPlayerIds: readonly string[];
}

export const DEFAULT_CAMERA_ELIMINATION_CONFIG: Readonly<CameraEliminationConfig> = Object.freeze({
  maximumDistanceFromLeaderMeters: 34,
  maximumDistanceFromCenterMeters: 20,
  graceSeconds: 1.5,
});

function distance(left: TrackVector3, right: TrackVector3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function validateSubject(subject: CameraEliminationSubject, ids: Set<string>): void {
  if (subject.id.length === 0 || ids.has(subject.id)) {
    throw new Error(`Camera elimination subject id ${JSON.stringify(subject.id)} is empty or duplicated`);
  }
  ids.add(subject.id);
  if (subject.position.some((component) => !Number.isFinite(component))) {
    throw new Error(`Camera elimination subject ${subject.id} must have a finite position`);
  }
  if (!Number.isInteger(subject.completedLaps) || subject.completedLaps < 0) {
    throw new Error(`Camera elimination subject ${subject.id} has invalid completedLaps`);
  }
  if (!Number.isInteger(subject.passedCheckpoints) || subject.passedCheckpoints < 0) {
    throw new Error(`Camera elimination subject ${subject.id} has invalid passedCheckpoints`);
  }
  if (
    !Number.isFinite(subject.distanceToNextCheckpointMeters)
    || subject.distanceToNextCheckpointMeters < 0
  ) {
    throw new Error(`Camera elimination subject ${subject.id} has invalid checkpoint distance`);
  }
}

function isAhead(left: CameraEliminationSubject, right: CameraEliminationSubject): boolean {
  return left.completedLaps > right.completedLaps
    || (
      left.completedLaps === right.completedLaps
      && (
        left.passedCheckpoints > right.passedCheckpoints
        || (
          left.passedCheckpoints === right.passedCheckpoints
          && left.distanceToNextCheckpointMeters < right.distanceToNextCheckpointMeters
        )
      )
    );
}

/** Fixed-step shared-camera knockout rule. Input order is the final deterministic tie-breaker. */
export class CameraEliminationTracker {
  readonly #config: Readonly<CameraEliminationConfig>;
  readonly #outsideSeconds = new Map<string, number>();

  constructor(config: CameraEliminationConfig = DEFAULT_CAMERA_ELIMINATION_CONFIG) {
    if (
      !Number.isFinite(config.maximumDistanceFromLeaderMeters)
      || config.maximumDistanceFromLeaderMeters <= 0
      || !Number.isFinite(config.maximumDistanceFromCenterMeters)
      || config.maximumDistanceFromCenterMeters <= 0
      || !Number.isFinite(config.graceSeconds)
      || config.graceSeconds < 0
    ) {
      throw new Error("Camera elimination distances must be positive and graceSeconds must be non-negative");
    }
    this.#config = Object.freeze({ ...config });
  }

  reset(): void {
    this.#outsideSeconds.clear();
  }

  update(
    stepSeconds: number,
    subjects: readonly CameraEliminationSubject[],
  ): CameraEliminationUpdate {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new Error("Camera elimination stepSeconds must be a finite positive number");
    }
    const ids = new Set<string>();
    subjects.forEach((subject) => validateSubject(subject, ids));
    for (const id of this.#outsideSeconds.keys()) {
      if (!ids.has(id)) {
        this.#outsideSeconds.delete(id);
      }
    }
    if (subjects.length === 0) {
      this.#outsideSeconds.clear();
      return { leaderId: null, warnings: [], eliminatedPlayerIds: [] };
    }

    let leader = subjects[0]!;
    for (const subject of subjects.slice(1)) {
      if (isAhead(subject, leader)) {
        leader = subject;
      }
    }
    if (subjects.length === 1) {
      this.#outsideSeconds.clear();
      return { leaderId: leader.id, warnings: [], eliminatedPlayerIds: [] };
    }

    const center: [number, number, number] = [0, 0, 0];
    for (const subject of subjects) {
      center[0] += subject.position[0] / subjects.length;
      center[1] += subject.position[1] / subjects.length;
      center[2] += subject.position[2] / subjects.length;
    }

    const warnings: CameraEliminationWarning[] = [];
    const eliminatedPlayerIds: string[] = [];
    this.#outsideSeconds.delete(leader.id);
    for (const subject of subjects) {
      if (subject.id === leader.id) {
        continue;
      }
      const distanceFromLeaderMeters = distance(subject.position, leader.position);
      const distanceFromCenterMeters = distance(subject.position, center);
      const outside = distanceFromLeaderMeters > this.#config.maximumDistanceFromLeaderMeters
        || distanceFromCenterMeters > this.#config.maximumDistanceFromCenterMeters;
      if (!outside) {
        this.#outsideSeconds.delete(subject.id);
        continue;
      }

      const outsideSeconds = (this.#outsideSeconds.get(subject.id) ?? 0) + stepSeconds;
      if (outsideSeconds + Number.EPSILON >= this.#config.graceSeconds) {
        this.#outsideSeconds.delete(subject.id);
        eliminatedPlayerIds.push(subject.id);
        continue;
      }
      this.#outsideSeconds.set(subject.id, outsideSeconds);
      warnings.push({
        playerId: subject.id,
        secondsRemaining: Math.max(0, this.#config.graceSeconds - outsideSeconds),
        distanceFromLeaderMeters,
        distanceFromCenterMeters,
      });
    }
    return { leaderId: leader.id, warnings, eliminatedPlayerIds };
  }
}
