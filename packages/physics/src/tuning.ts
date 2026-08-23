import { RuntimeEventBus } from "@mashed/core";
import type { VehicleInputFrame } from "@mashed/input";

import rawScenarios from "../data/tuning-scenarios.json" with { type: "json" };
import { createPhysicsRuntime, DEFAULT_VEHICLE_CONFIG, type PhysicsRuntime } from "./index.js";

interface TuningScenarios {
  version: 1;
  stepSeconds: number;
  settleSteps: number;
  acceleration: { durationSteps: number; targetSpeedKmh: number };
  braking: { accelerationSteps: number; maximumBrakingSteps: number; stoppedSpeedKmh: number };
  slalom: { durationSteps: number; switchEverySteps: number; steering: number };
  drift: { accelerationSteps: number; turnSteps: number; steering: number; handbrake: number };
}

export interface VehicleTuningReport {
  version: 1;
  configId: string;
  stepSeconds: number;
  acceleration: {
    targetSpeedKmh: number;
    targetTimeSeconds: number | null;
    distanceMeters: number;
    finalSpeedKmh: number;
    peakSpeedKmh: number;
  };
  braking: {
    initialSpeedKmh: number;
    stoppingTimeSeconds: number;
    stoppingDistanceMeters: number;
    finalSpeedKmh: number;
  };
  slalom: {
    distanceMeters: number;
    lateralOffsetMeters: number;
    peakLateralSpeedMetersPerSecond: number;
    peakSpeedKmh: number;
  };
  drift: {
    baselinePeakLateralSpeedMetersPerSecond: number;
    handbrakePeakLateralSpeedMetersPerSecond: number;
    baselineHeadingChangeRadians: number;
    handbrakeHeadingChangeRadians: number;
  };
}

const SCENARIOS = rawScenarios as unknown as TuningScenarios;
const DRIVE: VehicleInputFrame = { drive: 1, steer: 0, brake: 0, handbrake: 0, recover: false };
const BRAKE: VehicleInputFrame = { drive: 0, steer: 0, brake: 1, handbrake: 0, recover: false };

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function planarDistance(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  return Math.hypot(second[0] - first[0], second[2] - first[2]);
}

async function tuningRuntime(): Promise<PhysicsRuntime> {
  const runtime = await createPhysicsRuntime(
    new RuntimeEventBus(),
    SCENARIOS.stepSeconds,
    DEFAULT_VEHICLE_CONFIG,
    { collisionObjects: false },
  );
  for (let step = 0; step < SCENARIOS.settleSteps; step += 1) {
    runtime.step(SCENARIOS.stepSeconds);
  }
  return runtime;
}

async function accelerationReport(): Promise<VehicleTuningReport["acceleration"]> {
  const runtime = await tuningRuntime();
  try {
    const start = runtime.transformHistory.current.position;
    let targetStep: number | undefined;
    let peakSpeedKmh = 0;
    for (let step = 1; step <= SCENARIOS.acceleration.durationSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, DRIVE);
      const speedKmh = runtime.telemetry.speedMetersPerSecond * 3.6;
      peakSpeedKmh = Math.max(peakSpeedKmh, speedKmh);
      if (targetStep === undefined && speedKmh >= SCENARIOS.acceleration.targetSpeedKmh) {
        targetStep = step;
      }
    }
    return {
      targetSpeedKmh: SCENARIOS.acceleration.targetSpeedKmh,
      targetTimeSeconds: targetStep === undefined ? null : rounded(targetStep * SCENARIOS.stepSeconds),
      distanceMeters: rounded(planarDistance(start, runtime.transformHistory.current.position)),
      finalSpeedKmh: rounded(runtime.telemetry.speedMetersPerSecond * 3.6),
      peakSpeedKmh: rounded(peakSpeedKmh),
    };
  } finally {
    runtime.dispose();
  }
}

async function brakingReport(): Promise<VehicleTuningReport["braking"]> {
  const runtime = await tuningRuntime();
  try {
    for (let step = 0; step < SCENARIOS.braking.accelerationSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, DRIVE);
    }
    const initialSpeedKmh = runtime.telemetry.speedMetersPerSecond * 3.6;
    const start = runtime.transformHistory.current.position;
    let brakingSteps = SCENARIOS.braking.maximumBrakingSteps;
    for (let step = 1; step <= SCENARIOS.braking.maximumBrakingSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, BRAKE);
      if (runtime.telemetry.speedMetersPerSecond * 3.6 <= SCENARIOS.braking.stoppedSpeedKmh) {
        brakingSteps = step;
        break;
      }
    }
    return {
      initialSpeedKmh: rounded(initialSpeedKmh),
      stoppingTimeSeconds: rounded(brakingSteps * SCENARIOS.stepSeconds),
      stoppingDistanceMeters: rounded(planarDistance(start, runtime.transformHistory.current.position)),
      finalSpeedKmh: rounded(runtime.telemetry.speedMetersPerSecond * 3.6),
    };
  } finally {
    runtime.dispose();
  }
}

async function slalomReport(): Promise<VehicleTuningReport["slalom"]> {
  const runtime = await tuningRuntime();
  try {
    const start = runtime.transformHistory.current.position;
    let peakLateralSpeed = 0;
    let peakSpeedKmh = 0;
    for (let step = 0; step < SCENARIOS.slalom.durationSteps; step += 1) {
      const direction = Math.floor(step / SCENARIOS.slalom.switchEverySteps) % 2 === 0 ? 1 : -1;
      runtime.step(SCENARIOS.stepSeconds, {
        ...DRIVE,
        steer: SCENARIOS.slalom.steering * direction,
      });
      peakLateralSpeed = Math.max(peakLateralSpeed, Math.abs(runtime.telemetry.lateralSpeedMetersPerSecond));
      peakSpeedKmh = Math.max(peakSpeedKmh, runtime.telemetry.speedMetersPerSecond * 3.6);
    }
    const finish = runtime.transformHistory.current.position;
    return {
      distanceMeters: rounded(planarDistance(start, finish)),
      lateralOffsetMeters: rounded(Math.abs(finish[0] - start[0])),
      peakLateralSpeedMetersPerSecond: rounded(peakLateralSpeed),
      peakSpeedKmh: rounded(peakSpeedKmh),
    };
  } finally {
    runtime.dispose();
  }
}

async function driftRun(handbrake: number): Promise<{ peakLateralSpeed: number; headingChange: number }> {
  const runtime = await tuningRuntime();
  try {
    for (let step = 0; step < SCENARIOS.drift.accelerationSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, DRIVE);
    }
    const startingHeading = runtime.telemetry.headingRadians;
    let peakLateralSpeed = 0;
    for (let step = 0; step < SCENARIOS.drift.turnSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, {
        ...DRIVE,
        steer: SCENARIOS.drift.steering,
        handbrake,
      });
      peakLateralSpeed = Math.max(peakLateralSpeed, Math.abs(runtime.telemetry.lateralSpeedMetersPerSecond));
    }
    return {
      peakLateralSpeed,
      headingChange: Math.abs(runtime.telemetry.headingRadians - startingHeading),
    };
  } finally {
    runtime.dispose();
  }
}

export async function runVehicleTuningSuite(): Promise<VehicleTuningReport> {
  const [acceleration, braking, slalom, baselineDrift, handbrakeDrift] = await Promise.all([
    accelerationReport(),
    brakingReport(),
    slalomReport(),
    driftRun(0),
    driftRun(SCENARIOS.drift.handbrake),
  ]);
  return {
    version: 1,
    configId: DEFAULT_VEHICLE_CONFIG.id,
    stepSeconds: SCENARIOS.stepSeconds,
    acceleration,
    braking,
    slalom,
    drift: {
      baselinePeakLateralSpeedMetersPerSecond: rounded(baselineDrift.peakLateralSpeed),
      handbrakePeakLateralSpeedMetersPerSecond: rounded(handbrakeDrift.peakLateralSpeed),
      baselineHeadingChangeRadians: rounded(baselineDrift.headingChange),
      handbrakeHeadingChangeRadians: rounded(handbrakeDrift.headingChange),
    },
  };
}
