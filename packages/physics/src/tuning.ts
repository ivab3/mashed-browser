import { RuntimeEventBus } from "@mashed/core";
import type { VehicleInputFrame } from "@mashed/input";

import rawScenarios from "../data/tuning-scenarios.json" with { type: "json" };
import {
  createPhysicsRuntime,
  DEFAULT_VEHICLE_CONFIG,
  type PhysicsRuntime,
  type VehicleConfig,
} from "./index.js";

interface TuningScenarios {
  version: 2;
  stepSeconds: number;
  settleSteps: number;
  acceleration: { durationSteps: number; targetSpeedKmh: number };
  braking: { accelerationSteps: number; maximumBrakingSteps: number; stoppedSpeedKmh: number };
  slalom: { durationSteps: number; switchEverySteps: number; steering: number };
  drift: { accelerationSteps: number; turnSteps: number; steering: number; handbrake: number };
  cornering: { accelerationSteps: number; turnSteps: number; steering: number };
  impact: { maximumSteps: number; postImpactSteps: number };
}

export interface VehicleTuningReport {
  version: 2;
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
    baselinePeakSlipAngleDegrees: number;
    handbrakePeakSlipAngleDegrees: number;
    baselineHeadingChangeRadians: number;
    handbrakeHeadingChangeRadians: number;
    baselineExitSpeedKmh: number;
    handbrakeExitSpeedKmh: number;
  };
  cornering: {
    headingChangeRadians: number;
    peakLateralSpeedMetersPerSecond: number;
    peakSlipAngleDegrees: number;
    maximumBodyTiltDegrees: number;
    minimumGroundedWheels: number;
    wheelLiftTimeSeconds: number;
    exitSpeedKmh: number;
  };
  impact: {
    objectId: string | null;
    impactTimeSeconds: number | null;
    impactSpeedKmh: number | null;
    impactForceNewtons: number | null;
    postImpactSpeedKmh: number | null;
    speedRetentionRatio: number | null;
  };
}

export interface VehicleTuningDifference {
  metric: string;
  reference: number;
  candidate: number;
  delta: number;
  percent: number | null;
}

const SCENARIOS = rawScenarios as unknown as TuningScenarios;
const NEUTRAL: VehicleInputFrame = { drive: 0, steer: 0, brake: 0, handbrake: 0, recover: false };
const DRIVE: VehicleInputFrame = { drive: 1, steer: 0, brake: 0, handbrake: 0, recover: false };
const BRAKE_REVERSE: VehicleInputFrame = { drive: -1, steer: 0, brake: 0, handbrake: 0, recover: false };

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function angleDelta(current: number, previous: number): number {
  return Math.atan2(Math.sin(current - previous), Math.cos(current - previous));
}

function slipAngleDegrees(forwardSpeed: number, lateralSpeed: number): number {
  return Math.atan2(Math.abs(lateralSpeed), Math.max(Math.abs(forwardSpeed), 0.01)) * 180 / Math.PI;
}

function uprightDot(rotation: readonly [number, number, number, number]): number {
  return 1 - 2 * (rotation[0] * rotation[0] + rotation[2] * rotation[2]);
}

function planarDistance(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
): number {
  return Math.hypot(second[0] - first[0], second[2] - first[2]);
}

async function tuningRuntime(config: VehicleConfig): Promise<PhysicsRuntime> {
  const runtime = await createPhysicsRuntime(
    new RuntimeEventBus(),
    SCENARIOS.stepSeconds,
    config,
    { collisionObjects: false },
  );
  for (let step = 0; step < SCENARIOS.settleSteps; step += 1) {
    runtime.step(SCENARIOS.stepSeconds);
  }
  return runtime;
}

async function accelerationReport(config: VehicleConfig): Promise<VehicleTuningReport["acceleration"]> {
  const runtime = await tuningRuntime(config);
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

async function brakingReport(config: VehicleConfig): Promise<VehicleTuningReport["braking"]> {
  const runtime = await tuningRuntime(config);
  try {
    for (let step = 0; step < SCENARIOS.braking.accelerationSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, DRIVE);
    }
    const initialSpeedKmh = runtime.telemetry.speedMetersPerSecond * 3.6;
    const start = runtime.transformHistory.current.position;
    let brakingSteps = SCENARIOS.braking.maximumBrakingSteps;
    for (let step = 1; step <= SCENARIOS.braking.maximumBrakingSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, BRAKE_REVERSE);
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

async function slalomReport(config: VehicleConfig): Promise<VehicleTuningReport["slalom"]> {
  const runtime = await tuningRuntime(config);
  try {
    const start = runtime.transformHistory.current.position;
    let peakLateralSpeed = 0;
    let peakSpeedKmh = 0;
    for (let step = 0; step < SCENARIOS.slalom.durationSteps; step += 1) {
      const direction = Math.floor(step / SCENARIOS.slalom.switchEverySteps) % 2 === 0 ? 1 : -1;
      runtime.step(SCENARIOS.stepSeconds, {
        ...DRIVE,
        // Preserve the established physical tape after correcting the public steering sign.
        steer: -SCENARIOS.slalom.steering * direction,
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

async function driftRun(
  config: VehicleConfig,
  handbrake: number,
): Promise<{
  peakLateralSpeed: number;
  peakSlipAngleDegrees: number;
  headingChange: number;
  exitSpeedKmh: number;
}> {
  const runtime = await tuningRuntime(config);
  try {
    for (let step = 0; step < SCENARIOS.drift.accelerationSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, DRIVE);
    }
    let previousHeading = runtime.telemetry.headingRadians;
    let headingChange = 0;
    let peakLateralSpeed = 0;
    let peakSlipAngle = 0;
    for (let step = 0; step < SCENARIOS.drift.turnSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, {
        ...DRIVE,
        steer: -SCENARIOS.drift.steering,
        handbrake,
      });
      const telemetry = runtime.telemetry;
      peakLateralSpeed = Math.max(peakLateralSpeed, Math.abs(telemetry.lateralSpeedMetersPerSecond));
      peakSlipAngle = Math.max(
        peakSlipAngle,
        slipAngleDegrees(telemetry.forwardSpeedMetersPerSecond, telemetry.lateralSpeedMetersPerSecond),
      );
      headingChange += Math.abs(angleDelta(telemetry.headingRadians, previousHeading));
      previousHeading = telemetry.headingRadians;
    }
    return {
      peakLateralSpeed,
      peakSlipAngleDegrees: peakSlipAngle,
      headingChange,
      exitSpeedKmh: runtime.telemetry.speedMetersPerSecond * 3.6,
    };
  } finally {
    runtime.dispose();
  }
}

async function corneringReport(config: VehicleConfig): Promise<VehicleTuningReport["cornering"]> {
  const runtime = await tuningRuntime(config);
  try {
    for (let step = 0; step < SCENARIOS.cornering.accelerationSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, DRIVE);
    }
    let previousHeading = runtime.telemetry.headingRadians;
    let headingChange = 0;
    let peakLateralSpeed = 0;
    let peakSlipAngle = 0;
    let minimumUprightDot = 1;
    let minimumGroundedWheels = 4;
    let wheelLiftSteps = 0;
    for (let step = 0; step < SCENARIOS.cornering.turnSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds, {
        ...DRIVE,
        steer: -SCENARIOS.cornering.steering,
      });
      const telemetry = runtime.telemetry;
      peakLateralSpeed = Math.max(peakLateralSpeed, Math.abs(telemetry.lateralSpeedMetersPerSecond));
      peakSlipAngle = Math.max(
        peakSlipAngle,
        slipAngleDegrees(telemetry.forwardSpeedMetersPerSecond, telemetry.lateralSpeedMetersPerSecond),
      );
      minimumUprightDot = Math.min(minimumUprightDot, uprightDot(runtime.transformHistory.current.rotation));
      minimumGroundedWheels = Math.min(minimumGroundedWheels, telemetry.groundedWheels);
      wheelLiftSteps += telemetry.groundedWheels < 4 ? 1 : 0;
      headingChange += Math.abs(angleDelta(telemetry.headingRadians, previousHeading));
      previousHeading = telemetry.headingRadians;
    }
    return {
      headingChangeRadians: rounded(headingChange),
      peakLateralSpeedMetersPerSecond: rounded(peakLateralSpeed),
      peakSlipAngleDegrees: rounded(peakSlipAngle),
      maximumBodyTiltDegrees: rounded(Math.acos(Math.max(-1, Math.min(1, minimumUprightDot))) * 180 / Math.PI),
      minimumGroundedWheels,
      wheelLiftTimeSeconds: rounded(wheelLiftSteps * SCENARIOS.stepSeconds),
      exitSpeedKmh: rounded(runtime.telemetry.speedMetersPerSecond * 3.6),
    };
  } finally {
    runtime.dispose();
  }
}

async function impactReport(config: VehicleConfig): Promise<VehicleTuningReport["impact"]> {
  const events = new RuntimeEventBus();
  let currentStep = 0;
  let speedBeforeStepKmh = 0;
  let impact: {
    objectId: string;
    step: number;
    speedKmh: number;
    force: number;
  } | undefined;
  const unsubscribe = events.subscribe((event) => {
    if (event.type === "physics:object-destroyed" && !impact) {
      impact = {
        objectId: event.id,
        step: currentStep,
        speedKmh: speedBeforeStepKmh,
        force: event.impactForce,
      };
    }
  });
  const runtime = await createPhysicsRuntime(events, SCENARIOS.stepSeconds, config);
  try {
    for (let step = 0; step < SCENARIOS.settleSteps; step += 1) {
      runtime.step(SCENARIOS.stepSeconds);
    }
    for (currentStep = 1; currentStep <= SCENARIOS.impact.maximumSteps; currentStep += 1) {
      speedBeforeStepKmh = runtime.telemetry.speedMetersPerSecond * 3.6;
      runtime.step(SCENARIOS.stepSeconds, impact ? NEUTRAL : DRIVE);
      if (impact && currentStep - impact.step >= SCENARIOS.impact.postImpactSteps) {
        break;
      }
    }
    if (!impact) {
      return {
        objectId: null,
        impactTimeSeconds: null,
        impactSpeedKmh: null,
        impactForceNewtons: null,
        postImpactSpeedKmh: null,
        speedRetentionRatio: null,
      };
    }
    const postImpactSpeedKmh = runtime.telemetry.speedMetersPerSecond * 3.6;
    return {
      objectId: impact.objectId,
      impactTimeSeconds: rounded(impact.step * SCENARIOS.stepSeconds),
      impactSpeedKmh: rounded(impact.speedKmh),
      impactForceNewtons: rounded(impact.force),
      postImpactSpeedKmh: rounded(postImpactSpeedKmh),
      speedRetentionRatio: rounded(postImpactSpeedKmh / Math.max(impact.speedKmh, 0.001)),
    };
  } finally {
    unsubscribe();
    runtime.dispose();
  }
}

export async function runVehicleTuningSuite(
  config: VehicleConfig = DEFAULT_VEHICLE_CONFIG,
): Promise<VehicleTuningReport> {
  const [
    acceleration,
    braking,
    slalom,
    baselineDrift,
    handbrakeDrift,
    cornering,
    impact,
  ] = await Promise.all([
    accelerationReport(config),
    brakingReport(config),
    slalomReport(config),
    driftRun(config, 0),
    driftRun(config, SCENARIOS.drift.handbrake),
    corneringReport(config),
    impactReport(config),
  ]);
  return {
    version: 2,
    configId: config.id,
    stepSeconds: SCENARIOS.stepSeconds,
    acceleration,
    braking,
    slalom,
    drift: {
      baselinePeakLateralSpeedMetersPerSecond: rounded(baselineDrift.peakLateralSpeed),
      handbrakePeakLateralSpeedMetersPerSecond: rounded(handbrakeDrift.peakLateralSpeed),
      baselinePeakSlipAngleDegrees: rounded(baselineDrift.peakSlipAngleDegrees),
      handbrakePeakSlipAngleDegrees: rounded(handbrakeDrift.peakSlipAngleDegrees),
      baselineHeadingChangeRadians: rounded(baselineDrift.headingChange),
      handbrakeHeadingChangeRadians: rounded(handbrakeDrift.headingChange),
      baselineExitSpeedKmh: rounded(baselineDrift.exitSpeedKmh),
      handbrakeExitSpeedKmh: rounded(handbrakeDrift.exitSpeedKmh),
    },
    cornering,
    impact,
  };
}

function numericMetrics(value: unknown, prefix = ""): Map<string, number> {
  const metrics = new Map<string, number>();
  if (!value || typeof value !== "object") {
    return metrics;
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "number" && Number.isFinite(child)) {
      metrics.set(path, child);
    } else if (child && typeof child === "object") {
      for (const [nestedPath, nestedValue] of numericMetrics(child, path)) {
        metrics.set(nestedPath, nestedValue);
      }
    }
  }
  return metrics;
}

export function compareVehicleTuningReports(
  reference: VehicleTuningReport,
  candidate: VehicleTuningReport,
): VehicleTuningDifference[] {
  if (reference.version !== candidate.version || reference.stepSeconds !== candidate.stepSeconds) {
    throw new Error("Tuning reports must use the same version and fixed timestep");
  }
  const referenceMetrics = numericMetrics({
    acceleration: reference.acceleration,
    braking: reference.braking,
    slalom: reference.slalom,
    drift: reference.drift,
    cornering: reference.cornering,
    impact: reference.impact,
  });
  const candidateMetrics = numericMetrics({
    acceleration: candidate.acceleration,
    braking: candidate.braking,
    slalom: candidate.slalom,
    drift: candidate.drift,
    cornering: candidate.cornering,
    impact: candidate.impact,
  });
  return [...referenceMetrics].flatMap(([metric, referenceValue]) => {
    const candidateValue = candidateMetrics.get(metric);
    if (candidateValue === undefined) {
      return [];
    }
    const delta = candidateValue - referenceValue;
    return [{
      metric,
      reference: referenceValue,
      candidate: candidateValue,
      delta: rounded(delta),
      percent: Math.abs(referenceValue) < 1e-9 ? null : rounded(delta / referenceValue * 100),
    }];
  });
}
