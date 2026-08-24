import { describe, expect, it } from "vitest";

import storedBaseline from "../../../reference/vehicle-tuning-baseline.json" with { type: "json" };
import { DEFAULT_VEHICLE_CONFIG } from "../src/index.js";
import { compareVehicleTuningReports, runVehicleTuningSuite } from "../src/tuning.js";

describe("vehicle tuning scenarios", () => {
  it("produce a deterministic, measurable arcade baseline", async () => {
    const first = await runVehicleTuningSuite();
    const second = await runVehicleTuningSuite();
    expect(second).toEqual(first);
    expect(first).toEqual(storedBaseline.report);
    expect(first.acceleration.targetTimeSeconds).not.toBeNull();
    expect(first.acceleration.distanceMeters).toBeGreaterThan(20);
    expect(first.braking.stoppingTimeSeconds).toBeLessThan(2);
    expect(first.braking.stoppingDistanceMeters).toBeGreaterThan(2);
    expect(first.slalom.peakLateralSpeedMetersPerSecond).toBeGreaterThan(0.5);
    expect(first.drift.handbrakeHeadingChangeRadians)
      .toBeGreaterThan(first.drift.baselineHeadingChangeRadians);
    expect(first.cornering.minimumGroundedWheels).toBe(4);
    expect(first.cornering.maximumBodyTiltDegrees).toBeGreaterThan(0);
    expect(first.impact.objectId).toBe("crate-a");
    expect(first.impact.impactForceNewtons).toBeGreaterThan(8_500);
    expect(first.wallImpact.impactSpeedKmh).not.toBeNull();
    expect(first.wallImpact.peakReboundSpeedKmh).toBeGreaterThan(0);
    expect(compareVehicleTuningReports(first, second).every((difference) => difference.delta === 0))
      .toBe(true);
  });

  it("reports directional deltas for an alternative data-driven tune", async () => {
    const reference = await runVehicleTuningSuite();
    const fasterConfig = structuredClone(DEFAULT_VEHICLE_CONFIG);
    fasterConfig.id = "arcade-faster-test";
    fasterConfig.drive.engineForce *= 1.2;
    const candidate = await runVehicleTuningSuite(fasterConfig);
    const differences = compareVehicleTuningReports(reference, candidate);
    expect(candidate.configId).toBe("arcade-faster-test");
    expect(differences.find((difference) => difference.metric === "acceleration.targetTimeSeconds"))
      .toMatchObject({ delta: expect.any(Number) });
    expect(differences.find((difference) => difference.metric === "acceleration.targetTimeSeconds")?.delta)
      .toBeLessThan(0);
  });
});
