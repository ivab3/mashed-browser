import { RuntimeEventBus } from "@mashed/core";
import { describe, expect, it } from "vitest";

import { createPhysicsRuntime, DEFAULT_VEHICLE_CONFIG } from "../src/index.js";

describe("PhysicsRuntime", () => {
  it("uses a fixed timestep and repeats the same controlled vehicle simulation", async () => {
    const first = await createPhysicsRuntime(new RuntimeEventBus());
    const second = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      for (let step = 0; step < 300; step += 1) {
        const input = {
          drive: step < 240 ? 1 : 0,
          steer: step >= 90 && step < 180 ? 0.35 : 0,
          brake: step >= 240 ? 0.65 : 0,
          handbrake: step >= 160 && step < 185 ? 0.8 : 0,
          recover: false,
        };
        first.step(1 / 60, input);
        second.step(1 / 60, input);
      }
      expect(first.transformHistory.current).toEqual(second.transformHistory.current);
      expect(Math.hypot(
        first.transformHistory.current.position[0] - DEFAULT_VEHICLE_CONFIG.spawn.position[0],
        first.transformHistory.current.position[2] - DEFAULT_VEHICLE_CONFIG.spawn.position[2],
      )).toBeGreaterThan(5);
      expect(first.metrics).toEqual(second.metrics);
      expect(first.telemetry).toEqual(second.telemetry);
      expect(first.telemetry.groundedWheels).toBeGreaterThan(0);
      expect(first.debugLines().vertices.length).toBeGreaterThan(0);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("rejects a variable physics timestep", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      expect(() => physics.step(1 / 30)).toThrow("Physics timestep changed");
    } finally {
      physics.dispose();
    }
  });

  it("recovers upright above the current position", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      for (let step = 0; step < 60; step += 1) {
        physics.step(1 / 60);
      }
      const before = physics.transformHistory.current.position;
      physics.recover();
      const after = physics.transformHistory.current.position;
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBeGreaterThan(before[1]);
      expect(after[2]).toBe(before[2]);
      expect(physics.transformHistory.previous).toEqual(physics.transformHistory.current);
    } finally {
      physics.dispose();
    }
  });

  it("keeps the four surface handling profiles in vehicle data", () => {
    expect(Object.keys(DEFAULT_VEHICLE_CONFIG.surfaces)).toEqual(["asphalt", "ice", "sand", "mud"]);
    expect(DEFAULT_VEHICLE_CONFIG.surfaces.ice.sideFriction)
      .toBeLessThan(DEFAULT_VEHICLE_CONFIG.surfaces.asphalt.sideFriction);
    expect(DEFAULT_VEHICLE_CONFIG.surfaces.mud.rollingBrake).toBeGreaterThan(0);
  });
});
