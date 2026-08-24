import {
  LapSession,
  RuntimeEventBus,
  type LapCheckpoint,
} from "@mashed/core";
import type { VehicleInputFrame } from "@mashed/input";

import {
  createPhysicsRuntime,
  DEFAULT_VEHICLE_CONFIG,
  type StaticCollisionSector,
  type VehicleSpawn,
} from "./index.js";
import { deriveRouteCollisionLayers } from "./route-collision.js";

export interface LapValidationCourse {
  checkpoints: readonly LapCheckpoint[];
  splitCheckpointIds?: readonly number[];
  spawn: VehicleSpawn;
}

export interface RouteDriverState {
  position: readonly [number, number, number];
  headingRadians: number;
  speedMetersPerSecond: number;
  precedingCheckpoint?: LapCheckpoint;
  checkpoint: LapCheckpoint;
  followingCheckpoint: LapCheckpoint;
  targetPosition?: readonly [number, number, number];
  minimumTargetSpeedMetersPerSecond?: number;
}

export interface LapValidationOptions {
  stepSeconds?: number;
  maximumSteps?: number;
}

export interface LapValidationReport {
  version: 1;
  completed: boolean;
  completedLaps: number;
  passedCheckpoints: number;
  totalCheckpoints: number;
  elapsedSeconds: number;
  simulationSteps: number;
  collisionTriangles: number;
  maximumSpeedKmh: number;
  reverseFrames: number;
  recoveryFrames: number;
  finalPosition: readonly [number, number, number];
  finalRotation: readonly [number, number, number, number];
  finalHeadingRadians: number;
  finalSpeedKmh: number;
  finalGroundedWheels: number;
  nextCheckpointId: number;
  closestDistanceToNextCheckpointMeters: number;
  closestPositionToNextCheckpoint: readonly [number, number, number];
  recentCheckpointPasses: ReadonlyArray<{
    id: number;
    elapsedSeconds: number;
    speedKmh: number;
    headingRadians: number;
    position: readonly [number, number, number];
  }>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function headingBetween(
  start: readonly [number, number, number],
  finish: readonly [number, number, number],
): number {
  return Math.atan2(finish[0] - start[0], finish[2] - start[2]);
}

function checkpointTarget(
  checkpoint: LapCheckpoint,
  bias: number,
): readonly [number, number, number] {
  const points = checkpoint.triangles.flatMap((triangle) => triangle);
  let first = points[0] ?? checkpoint.center;
  let second = first;
  let maximumDistance = 0;
  for (const start of points) {
    for (const finish of points) {
      const distance = Math.hypot(finish[0] - start[0], finish[2] - start[2]);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        first = start;
        second = finish;
      }
    }
  }
  return [
    checkpoint.center[0] + (second[0] - first[0]) * bias,
    checkpoint.center[1],
    checkpoint.center[2] + (second[2] - first[2]) * bias,
  ];
}

function checkpointFloor(checkpoint: LapCheckpoint): number {
  return Math.min(...checkpoint.triangles.flatMap((triangle) => triangle.map((point) => point[1])));
}

function demandingApproachCheckpointIds(course: LapValidationCourse): ReadonlySet<number> {
  const result = new Set<number>();
  for (let index = 0; index < course.checkpoints.length; index += 1) {
    const start = course.checkpoints[index]!;
    const finish = course.checkpoints[(index + 1) % course.checkpoints.length]!;
    const startFloor = checkpointFloor(start);
    const finishFloor = checkpointFloor(finish);
    const horizontalDistance = Math.hypot(
      finish.center[0] - start.center[0],
      finish.center[2] - start.center[2],
    );
    const steepClimb = horizontalDistance > 1e-5
      && (finishFloor - startFloor) / horizontalDistance > 0.08;
    if (steepClimb) {
      for (let approach = -3; approach <= 1; approach += 1) {
        result.add(course.checkpoints[
          (index + approach + course.checkpoints.length) % course.checkpoints.length
        ]!.id);
      }
    }
  }
  return result;
}

/** A conservative route follower used to exercise the same input path as a player. */
export function createRouteInput(state: RouteDriverState): VehicleInputFrame {
  const targetPosition = state.targetPosition ?? state.checkpoint.center;
  const targetHeading = headingBetween(state.position, targetPosition);
  const entryHeading = state.precedingCheckpoint
    ? headingBetween(state.precedingCheckpoint.center, state.checkpoint.center)
    : targetHeading;
  const exitHeading = headingBetween(state.checkpoint.center, state.followingCheckpoint.center);
  const headingError = wrapRadians(targetHeading - state.headingRadians);
  const cornerAngle = Math.abs(wrapRadians(exitHeading - entryHeading));
  const severity = Math.max(
    clamp(Math.abs(headingError) / 1.25, 0, 1),
    clamp(cornerAngle / 1.4, 0, 1),
  );
  const targetSpeed = Math.max(
    3 + (1 - severity) * 5,
    state.minimumTargetSpeedMetersPerSecond ?? 0,
  );
  const overspeed = state.speedMetersPerSecond - targetSpeed;
  const brake = overspeed > 0.8 ? clamp(overspeed / 4, 0, 1) : 0;

  return {
    drive: brake > 0 ? 0 : state.speedMetersPerSecond < targetSpeed ? 1 : 0.2,
    steer: clamp(-headingError * 1.55, -1, 1),
    brake,
    handbrake: Math.abs(headingError) > 0.85 && state.speedMetersPerSecond > 6 ? 0.25 : 0,
    recover: false,
  };
}

/** Backs away from an obstacle before another route-line attempt. */
export function createRouteEscapeInput(): VehicleInputFrame {
  return {
    drive: -0.75,
    steer: 0,
    brake: 0,
    handbrake: 0,
    recover: false,
  };
}

export async function runLapValidation(
  course: LapValidationCourse,
  collision: readonly StaticCollisionSector[],
  options: LapValidationOptions = {},
): Promise<LapValidationReport> {
  const stepSeconds = options.stepSeconds ?? 1 / 60;
  const maximumSteps = options.maximumSteps ?? 60 * 8 * 60;
  const runtime = await createPhysicsRuntime(
    new RuntimeEventBus(),
    stepSeconds,
    DEFAULT_VEHICLE_CONFIG,
    { collisionObjects: false },
  );
  const lap = new LapSession(course);
  const checkpointById = new Map(course.checkpoints.map((checkpoint, index) => (
    [checkpoint.id, { checkpoint, index }] as const
  )));
  const demandingApproaches = demandingApproachCheckpointIds(course);
  let steps = 0;
  let maximumSpeedKmh = 0;
  let reverseFrames = 0;
  let recoveryFrames = 0;
  let lastCheckpointStep = 0;
  let retryIndex = 0;
  let reverseUntilStep = 0;
  const recentCheckpointPasses: Array<{
    id: number;
    elapsedSeconds: number;
    speedKmh: number;
    headingRadians: number;
    position: readonly [number, number, number];
  }> = [];
  const retryBiases = [0, 0.12, -0.12, 0.24, -0.24, 0.36, -0.36] as const;
  let closestNextCheckpointId = course.checkpoints[1]!.id;
  let closestDistanceToNextCheckpointMeters = Number.POSITIVE_INFINITY;
  let closestPositionToNextCheckpoint = course.spawn.position;

  try {
    const collisionTriangles = runtime.setTrackCollision(deriveRouteCollisionLayers(course, collision));
    runtime.setRaceSpawn(course.spawn);

    for (steps = 1; steps <= maximumSteps; steps += 1) {
      const progress = lap.progress;
      const target = checkpointById.get(progress.nextCheckpointId);
      if (!target) {
        throw new Error(`Lap references missing checkpoint ${progress.nextCheckpointId}`);
      }
      const following = course.checkpoints[(target.index + 1) % course.checkpoints.length]!;
      const preceding = course.checkpoints[
        (target.index - 1 + course.checkpoints.length) % course.checkpoints.length
      ]!;
      const telemetry = runtime.telemetry;
      if (
        steps >= reverseUntilStep
        && steps - lastCheckpointStep >= 360
        && telemetry.speedMetersPerSecond < 0.6
      ) {
        retryIndex += 1;
        reverseUntilStep = steps + 90;
        lastCheckpointStep = steps;
      }
      const routeInput = createRouteInput({
        position: runtime.transformHistory.current.position,
        headingRadians: telemetry.headingRadians,
        speedMetersPerSecond: telemetry.speedMetersPerSecond,
        precedingCheckpoint: preceding,
        checkpoint: target.checkpoint,
        followingCheckpoint: following,
        minimumTargetSpeedMetersPerSecond: demandingApproaches.has(target.checkpoint.id) ? 12 : 0,
        targetPosition: checkpointTarget(
          target.checkpoint,
          retryBiases[retryIndex % retryBiases.length]!,
        ),
      });
      const input = steps < reverseUntilStep ? createRouteEscapeInput() : routeInput;
      if (input.drive < 0) {
        reverseFrames += 1;
      }
      if (input.recover) {
        recoveryFrames += 1;
      }
      runtime.step(stepSeconds, input);
      const currentPosition = runtime.transformHistory.current.position;
      if (closestNextCheckpointId !== target.checkpoint.id) {
        closestNextCheckpointId = target.checkpoint.id;
        closestDistanceToNextCheckpointMeters = Number.POSITIVE_INFINITY;
      }
      const targetDistance = Math.hypot(
        currentPosition[0] - target.checkpoint.center[0],
        currentPosition[2] - target.checkpoint.center[2],
      );
      if (targetDistance < closestDistanceToNextCheckpointMeters) {
        closestDistanceToNextCheckpointMeters = targetDistance;
        closestPositionToNextCheckpoint = currentPosition;
      }
      maximumSpeedKmh = Math.max(maximumSpeedKmh, runtime.telemetry.speedMetersPerSecond * 3.6);
      const history = runtime.transformHistory;
      const update = lap.update(history.current.position, history.previous.position);
      if (update.checkpointPassed !== null) {
        recentCheckpointPasses.push({
          id: update.checkpointPassed,
          elapsedSeconds: steps * stepSeconds,
          speedKmh: runtime.telemetry.speedMetersPerSecond * 3.6,
          headingRadians: runtime.telemetry.headingRadians,
          position: runtime.transformHistory.current.position,
        });
        if (recentCheckpointPasses.length > 8) {
          recentCheckpointPasses.shift();
        }
        lastCheckpointStep = steps;
        retryIndex = 0;
        reverseUntilStep = 0;
      }
      if (update.lapCompleted) {
        const finish = lap.progress;
        return {
          version: 1,
          completed: true,
          completedLaps: finish.completedLaps,
          passedCheckpoints: finish.passedCheckpoints,
          totalCheckpoints: finish.totalCheckpoints,
          elapsedSeconds: steps * stepSeconds,
          simulationSteps: steps,
          collisionTriangles,
          maximumSpeedKmh,
          reverseFrames,
          recoveryFrames,
          finalPosition: runtime.transformHistory.current.position,
          finalRotation: runtime.transformHistory.current.rotation,
          finalHeadingRadians: runtime.telemetry.headingRadians,
          finalSpeedKmh: runtime.telemetry.speedMetersPerSecond * 3.6,
          finalGroundedWheels: runtime.telemetry.groundedWheels,
          nextCheckpointId: finish.nextCheckpointId,
          closestDistanceToNextCheckpointMeters,
          closestPositionToNextCheckpoint,
          recentCheckpointPasses,
        };
      }
    }

    const finish = lap.progress;
    return {
      version: 1,
      completed: false,
      completedLaps: finish.completedLaps,
      passedCheckpoints: finish.passedCheckpoints,
      totalCheckpoints: finish.totalCheckpoints,
      elapsedSeconds: maximumSteps * stepSeconds,
      simulationSteps: maximumSteps,
      collisionTriangles,
      maximumSpeedKmh,
      reverseFrames,
      recoveryFrames,
      finalPosition: runtime.transformHistory.current.position,
      finalRotation: runtime.transformHistory.current.rotation,
      finalHeadingRadians: runtime.telemetry.headingRadians,
      finalSpeedKmh: runtime.telemetry.speedMetersPerSecond * 3.6,
      finalGroundedWheels: runtime.telemetry.groundedWheels,
      nextCheckpointId: finish.nextCheckpointId,
      closestDistanceToNextCheckpointMeters,
      closestPositionToNextCheckpoint,
      recentCheckpointPasses,
    };
  } finally {
    runtime.dispose();
  }
}
