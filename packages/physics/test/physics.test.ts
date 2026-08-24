import { RuntimeEventBus, type RuntimeEvent } from "@mashed/core";
import { describe, expect, it } from "vitest";

import { createPhysicsRuntime, DEFAULT_VEHICLE_CONFIG } from "../src/index.js";

describe("PhysicsRuntime", () => {
  it("keeps a neutral vehicle upright and stationary during an idle soak", async () => {
    const physics = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
    try {
      const start = physics.transformHistory.current.position;
      let minimumUprightDot = 1;
      for (let step = 0; step < 900; step += 1) {
        physics.step(1 / 60);
        const [x, , z] = physics.transformHistory.current.rotation;
        minimumUprightDot = Math.min(minimumUprightDot, 1 - 2 * (x * x + z * z));
      }
      const finish = physics.transformHistory.current.position;
      expect(minimumUprightDot).toBeGreaterThan(0.995);
      expect(Math.hypot(finish[0] - start[0], finish[2] - start[2])).toBeLessThan(0.01);
      expect(physics.telemetry.speedMetersPerSecond).toBeLessThan(0.01);
      expect(physics.telemetry.groundedWheels).toBe(4);
    } finally {
      physics.dispose();
    }
  });

  it("uses a fixed timestep and repeats the same controlled vehicle simulation", async () => {
    const first = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
    const second = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
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

  it("binds validated BSP-style triangle sectors as static track collision", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      expect(physics.setTrackCollision([{
        positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]),
        indices: new Uint32Array([0, 1, 2]),
      }])).toBe(1);
      expect(physics.metrics.trackTriangles).toBe(1);
      expect(() => physics.setTrackCollision([{
        positions: new Float32Array([0, 0, 0]),
        indices: new Uint32Array([0, 1, 2]),
      }])).toThrow("references vertex");
      expect(physics.metrics.trackTriangles).toBe(1);
      physics.clearTrackCollision();
      expect(physics.metrics.trackTriangles).toBe(0);
    } finally {
      physics.dispose();
    }
  });

  it("disables test-arena collision while a real track mesh is bound", async () => {
    const physics = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
    try {
      physics.setTrackCollision([{
        positions: new Float32Array([100, 0, 100, 104, 0, 100, 100, 0, 104]),
        indices: new Uint32Array([0, 1, 2]),
      }]);
      for (let step = 0; step < 60; step += 1) {
        physics.step(1 / 60);
      }
      expect(physics.transformHistory.current.position[1]).toBeLessThan(-2);

      physics.clearTrackCollision();
      physics.resetDemo();
      for (let step = 0; step < 120; step += 1) {
        physics.step(1 / 60);
      }
      expect(physics.telemetry.groundedWheels).toBe(4);
    } finally {
      physics.dispose();
    }
  });

  it("combines adjacent track sectors into one collider", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      const collidersBefore = physics.metrics.colliders;
      expect(physics.setTrackCollision([
        {
          positions: new Float32Array([-2, 0, -2, 0, 0, -2, -2, 0, 2]),
          indices: new Uint32Array([0, 1, 2]),
        },
        {
          positions: new Float32Array([0, 0, -2, 2, 0, -2, 2, 0, 2]),
          indices: new Uint32Array([0, 1, 2]),
        },
      ])).toBe(2);
      expect(physics.metrics.colliders).toBe(collidersBefore + 1);
    } finally {
      physics.dispose();
    }
  });

  it("binds drive and scenery as separate collision layers", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      const collidersBefore = physics.metrics.colliders;
      const sector = {
        positions: new Float32Array([-2, 0, -2, 2, 0, -2, 0, 0, 2]),
        indices: new Uint32Array([0, 1, 2]),
      };
      expect(physics.setTrackCollision({ drive: [sector], scenery: [sector] })).toBe(2);
      expect(physics.metrics.colliders).toBe(collidersBefore + 2);
    } finally {
      physics.dispose();
    }
  });

  it("climbs a steep road without accumulating helper forces across steps", async () => {
    const physics = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
    try {
      physics.setTrackCollision([{
        positions: new Float32Array([
          -5, 0, -5,
          -5, 5, 20,
          5, 0, -5,
          5, 5, 20,
        ]),
        indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
      }]);
      physics.setRaceSpawn({ position: [0, 1.45, -2], headingRadians: 0 });
      for (let step = 0; step < 300; step += 1) {
        physics.step(1 / 60, { drive: 1, steer: 0, brake: 0, handbrake: 0, recover: false });
      }

      expect(physics.transformHistory.current.position[2]).toBeGreaterThan(10);
      expect(physics.transformHistory.current.position[1]).toBeGreaterThan(3);
      expect(physics.telemetry.speedMetersPerSecond).toBeLessThan(10);
    } finally {
      physics.dispose();
    }
  });

  it("uses a track-provided race spawn for resets and recovery height", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      physics.setRaceSpawn({ position: [40, 2, 6], headingRadians: -Math.PI / 2 });
      expect(physics.transformHistory.current.position).toEqual([40, 2, 6]);
      physics.step(1 / 60, { drive: 1, steer: 0, brake: 0, handbrake: 0, recover: false });
      physics.resetDemo();
      expect(physics.transformHistory.current.position).toEqual([40, 2, 6]);
      expect(() => physics.setRaceSpawn({ position: [Number.NaN, 0, 0], headingRadians: 0 }))
        .toThrow("finite coordinates");
    } finally {
      physics.dispose();
    }
  });

  it("moves dynamic props, destroys breakable ones, and restores them on reset", async () => {
    const events = new RuntimeEventBus();
    const received: RuntimeEvent[] = [];
    events.subscribe((event) => received.push(event));
    const physics = await createPhysicsRuntime(events);
    try {
      const heavyStart = physics.sceneObjects.find((object) => object.id === "block-heavy")!;
      for (let step = 0; step < 300; step += 1) {
        physics.step(1 / 60, { drive: 1, steer: 0, brake: 0, handbrake: 0, recover: false });
      }
      const destroyedIds = received.flatMap((event) => (
        event.type === "physics:object-destroyed" ? [event.id] : []
      ));
      expect(destroyedIds)
        .toEqual(["crate-a", "crate-b", "barrel-a"]);
      expect(physics.metrics.destroyedObjects).toBe(3);
      const heavyFinish = physics.sceneObjects.find((object) => object.id === "block-heavy")!;
      expect(heavyFinish.history.current.position[2]).toBeGreaterThan(heavyStart.history.current.position[2]);

      physics.resetDemo();
      expect(physics.metrics.activeObjects).toBe(4);
      expect(physics.metrics.destroyedObjects).toBe(0);
      expect(physics.sceneObjects.every((object) => object.active)).toBe(true);
    } finally {
      physics.dispose();
    }
  });
});
