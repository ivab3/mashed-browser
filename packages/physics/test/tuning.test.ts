import { describe, expect, it } from "vitest";

import storedBaseline from "../../../reference/vehicle-tuning-baseline.json" with { type: "json" };
import { runVehicleTuningSuite } from "../src/tuning.js";

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
    expect(first.slalom.peakLateralSpeedMetersPerSecond).toBeGreaterThan(1);
    expect(first.drift.handbrakeHeadingChangeRadians)
      .toBeGreaterThan(first.drift.baselineHeadingChangeRadians);
  });
});
