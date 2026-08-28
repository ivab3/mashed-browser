import { RuntimeEventBus, type RuntimeEvent } from "@mashed/core";
import { describe, expect, it } from "vitest";

import {
  createPhysicsRuntime,
  DEFAULT_VEHICLE_CONFIG,
  driveForceBuildUpFactor,
  PRIMARY_VEHICLE_ID,
  sourceHandlingScales,
  steeringSpeedScale,
} from "../src/index.js";

describe("PhysicsRuntime", () => {
  it("reproduces the original six-second drive-force build-up curve", () => {
    expect(driveForceBuildUpFactor(0, 0.5, 6)).toBe(0.5);
    expect(driveForceBuildUpFactor(3, 0.5, 6)).toBe(0.75);
    expect(driveForceBuildUpFactor(6, 0.5, 6)).toBe(1);
    expect(driveForceBuildUpFactor(12, 0.5, 6)).toBe(1);
  });

  it("supports the accepted linear and source-derived reciprocal steering curves", () => {
    expect(steeringSpeedScale(0, 30, "linear", 0.64)).toBe(1);
    expect(steeringSpeedScale(15, 30, "linear", 0.64)).toBeCloseTo(0.68);
    expect(steeringSpeedScale(30, 30, "linear", 0.64)).toBeCloseTo(0.36);
    expect(steeringSpeedScale(15, 30, "reciprocal", 1.5)).toBeCloseTo(1 / 1.75);
    expect(steeringSpeedScale(30, 30, "reciprocal", 1.5)).toBeCloseTo(0.4);
  });

  it("anchors source Grip and Handling to Crusader without changing its accepted tune", () => {
    expect(sourceHandlingScales({ grip: 35_000, handling: 0.9 })).toEqual({
      grip: 1,
      handling: 1,
    });
    expect(sourceHandlingScales({ grip: 45_000, handling: 1.2 })).toEqual({
      grip: 45_000 / 35_000,
      handling: 0.75,
    });
    expect(sourceHandlingScales({ grip: 0, handling: Number.NaN })).toEqual({
      grip: 1,
      handling: 1,
    });
  });

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

  it("resolves a deterministic collision between equal compound vehicles", async () => {
    const options = {
      collisionObjects: false,
      collisionVehicle: {
        id: "vehicle-two",
        spawn: { position: [-4, 1.05, 10] as const, headingRadians: Math.PI },
      },
    };
    const first = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      options,
    );
    const second = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      options,
    );
    const control = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
    try {
      for (let step = 0; step < 60; step += 1) {
        first.step(1 / 60);
        second.step(1 / 60);
        control.step(1 / 60);
      }
      const targetStart = first.sceneObjects.find((object) => object.id === "vehicle-two")!;
      expect(targetStart.kind).toBe("vehicle");
      expect(first.telemetry.groundedWheels).toBe(4);

      const input = { drive: 1, steer: 0, brake: 0, handbrake: 0, recover: false };
      for (let step = 0; step < 240; step += 1) {
        first.step(1 / 60, input);
        second.step(1 / 60, input);
        control.step(1 / 60, input);
      }

      const firstTarget = first.sceneObjects.find((object) => object.id === "vehicle-two")!;
      const secondTarget = second.sceneObjects.find((object) => object.id === "vehicle-two")!;
      expect(first.transformHistory.current).toEqual(second.transformHistory.current);
      expect(firstTarget.history.current).toEqual(secondTarget.history.current);
      expect(firstTarget.history.current.position[2]).toBeGreaterThan(
        targetStart.history.current.position[2] + 5,
      );
      expect(first.transformHistory.current.position[2]).toBeLessThan(
        control.transformHistory.current.position[2] - 5,
      );

      first.resetDemo();
      const resetPosition = first.sceneObjects
        .find((object) => object.id === "vehicle-two")!.history.current.position;
      resetPosition.forEach((component, index) => {
        expect(component).toBeCloseTo(options.collisionVehicle.spawn.position[index]!);
      });
    } finally {
      first.dispose();
      second.dispose();
      control.dispose();
    }
  });

  it("drives and reports the second vehicle through an independent input stream", async () => {
    const spawn = { position: [4, 1.05, -8] as const, headingRadians: 0 };
    const physics = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      {
        collisionObjects: false,
        collisionVehicle: { id: "vehicle-two", spawn },
      },
    );
    try {
      for (let step = 0; step < 60; step += 1) {
        physics.step(1 / 60);
      }
      const primaryStart = physics.transformHistory.current.position;
      const secondaryStart = physics.sceneObjects
        .find((object) => object.id === "vehicle-two")!.history.current.position;

      const secondaryInput = {
        drive: 1,
        steer: 0.25,
        brake: 0,
        handbrake: 0,
        recover: false,
      };
      for (let step = 0; step < 180; step += 1) {
        physics.step(1 / 60, undefined, { "vehicle-two": secondaryInput });
      }

      const secondary = physics.sceneObjects.find((object) => object.id === "vehicle-two")!;
      expect(Math.hypot(
        physics.transformHistory.current.position[0] - primaryStart[0],
        physics.transformHistory.current.position[2] - primaryStart[2],
      )).toBeLessThan(0.02);
      expect(Math.hypot(
        secondary.history.current.position[0] - secondaryStart[0],
        secondary.history.current.position[2] - secondaryStart[2],
      )).toBeGreaterThan(5);
      expect(physics.getVehicleTelemetry(PRIMARY_VEHICLE_ID)).toEqual(physics.telemetry);
      expect(physics.getVehicleTelemetry("missing-vehicle")).toBeUndefined();
      expect(physics.getVehicleTelemetry("vehicle-two")).toMatchObject({
        groundedWheels: 4,
      });
      expect(physics.getVehicleTelemetry("vehicle-two")!.speedMetersPerSecond).toBeGreaterThan(3);
      expect(physics.getVehicleTelemetry("vehicle-two")!.steeringRadians).toBeGreaterThan(0);

      const heightBeforeRecovery = secondary.history.current.position[1];
      physics.step(1 / 60, undefined, {
        "vehicle-two": { ...secondaryInput, drive: 0, steer: 0, recover: true },
      });
      expect(physics.sceneObjects
        .find((object) => object.id === "vehicle-two")!.history.current.position[1])
        .toBeGreaterThan(heightBeforeRecovery + 0.5);

      physics.resetDemo();
      physics.sceneObjects.find((object) => object.id === "vehicle-two")!
        .history.current.position.forEach((component, index) => {
          expect(component).toBeCloseTo(spawn.position[index]!);
        });
    } finally {
      physics.dispose();
    }
  });

  it("configures and drives four production vehicle slots through one input map", async () => {
    const roster = [
      { id: PRIMARY_VEHICLE_ID, spawn: { position: [-12, 1.05, -8] as const, headingRadians: 0 } },
      { id: "vehicle-two", spawn: { position: [-4, 1.05, -8] as const, headingRadians: 0 } },
      { id: "vehicle-three", spawn: { position: [4, 1.05, -8] as const, headingRadians: 0 } },
      { id: "vehicle-four", spawn: { position: [12, 1.05, -8] as const, headingRadians: 0 } },
    ];
    const physics = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
    try {
      physics.setVehicleRoster(roster);
      expect(physics.vehicleIds).toEqual(roster.map((entry) => entry.id));
      expect(physics.sceneObjects.filter((object) => object.kind === "vehicle" && object.active))
        .toHaveLength(3);

      for (let step = 0; step < 60; step += 1) {
        physics.stepVehicles(1 / 60);
      }
      const starts = new Map(roster.map((entry) => [
        entry.id,
        physics.getVehicleTransformHistory(entry.id)!.current.position,
      ]));
      const input = { drive: 1, steer: 0.2, brake: 0, handbrake: 0, recover: false };
      for (let step = 0; step < 180; step += 1) {
        physics.stepVehicles(1 / 60, { "vehicle-three": input });
      }
      for (const entry of roster) {
        const start = starts.get(entry.id)!;
        const finish = physics.getVehicleTransformHistory(entry.id)!.current.position;
        const distance = Math.hypot(finish[0] - start[0], finish[2] - start[2]);
        if (entry.id === "vehicle-three") {
          expect(distance).toBeGreaterThan(5);
          expect(physics.getVehicleTelemetry(entry.id)!.speedMetersPerSecond).toBeGreaterThan(3);
        } else {
          expect(distance).toBeLessThan(0.02);
        }
      }

      physics.setVehicleRoster(roster.slice(0, 2));
      expect(physics.vehicleIds).toEqual([PRIMARY_VEHICLE_ID, "vehicle-two"]);
      expect(physics.getVehicleTransformHistory("vehicle-three")).toBeUndefined();
      expect(physics.sceneObjects.filter((object) => object.kind === "vehicle" && object.active))
        .toHaveLength(1);
      expect(physics.metrics.destroyedObjects).toBe(0);
    } finally {
      physics.dispose();
    }
  });

  it("deactivates eliminated vehicles until the next match reset", async () => {
    const roster = [
      { id: PRIMARY_VEHICLE_ID, spawn: { position: [-2, 1.05, -8] as const, headingRadians: 0 } },
      { id: "vehicle-two", spawn: { position: [2, 1.05, -8] as const, headingRadians: 0 } },
    ];
    const physics = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
    try {
      physics.setVehicleRoster(roster);
      const primaryBefore = physics.getVehicleTransformHistory(PRIMARY_VEHICLE_ID)!.current.position;
      const secondBefore = physics.getVehicleTransformHistory("vehicle-two")!.current.position;
      physics.deactivateVehicle(PRIMARY_VEHICLE_ID);
      physics.deactivateVehicle("vehicle-two");
      physics.deactivateVehicle("vehicle-two");
      expect(physics.activeVehicleIds).toEqual([]);
      expect(physics.getVehicleTelemetry(PRIMARY_VEHICLE_ID)).toBeUndefined();
      expect(physics.getVehicleTelemetry("vehicle-two")).toBeUndefined();
      expect(physics.sceneObjects.find((object) => object.id === "vehicle-two")?.active).toBe(false);

      const input = { drive: 1, steer: 1, brake: 0, handbrake: 0, recover: true };
      for (let step = 0; step < 30; step += 1) {
        physics.stepVehicles(1 / 60, {
          [PRIMARY_VEHICLE_ID]: input,
          "vehicle-two": input,
        });
      }
      expect(physics.getVehicleTransformHistory(PRIMARY_VEHICLE_ID)!.current.position).toEqual(primaryBefore);
      expect(physics.getVehicleTransformHistory("vehicle-two")!.current.position).toEqual(secondBefore);

      physics.resetDemo();
      expect(physics.activeVehicleIds).toEqual([PRIMARY_VEHICLE_ID, "vehicle-two"]);
      expect(physics.getVehicleTelemetry(PRIMARY_VEHICLE_ID)).toBeDefined();
      expect(physics.getVehicleTelemetry("vehicle-two")).toBeDefined();
      physics.getVehicleTransformHistory(PRIMARY_VEHICLE_ID)!.current.position.forEach((component, index) => {
        expect(component).toBeCloseTo(roster[0]!.spawn.position[index]!);
      });
      physics.getVehicleTransformHistory("vehicle-two")!.current.position.forEach((component, index) => {
        expect(component).toBeCloseTo(roster[1]!.spawn.position[index]!);
      });
      expect(() => physics.deactivateVehicle("missing")).toThrow(/Unknown active-roster vehicle/);
    } finally {
      physics.dispose();
    }
  });

  it("maps positive player steering to Rapier's mirrored wheel-steering direction", async () => {
    const physics = await createPhysicsRuntime(
      new RuntimeEventBus(),
      1 / 60,
      DEFAULT_VEHICLE_CONFIG,
      { collisionObjects: false },
    );
    try {
      for (let step = 0; step < 60; step += 1) {
        physics.step(1 / 60);
      }
      const startX = physics.transformHistory.current.position[0];
      for (let step = 0; step < 180; step += 1) {
        physics.step(1 / 60, {
          drive: 1,
          steer: 0.6,
          brake: 0,
          handbrake: 0,
          recover: false,
        });
      }
      expect(physics.telemetry.steeringRadians).toBeGreaterThan(0);
      expect(physics.telemetry.headingRadians).toBeLessThan(0);
      expect(physics.transformHistory.current.position[0]).toBeLessThan(startX - 5);
    } finally {
      physics.dispose();
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
