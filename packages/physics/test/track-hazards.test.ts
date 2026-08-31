import { describe, expect, it } from "vitest";
import { ALPHA_BARREL_EXPLOSION, CombatSession, FixedStepClock, RuntimeEventBus } from "@mashed/core";
import { createPhysicsRuntime, TrackHazardRuntime, PRIMARY_VEHICLE_ID, type TrackBarrelSpec } from "../src/index.js";

const barrel: TrackBarrelSpec = {
  id: "track-barrel:test:0", position: [-4, 0.55, 7], rotation: [0, 0, 0, 1], halfExtents: [0.42, 0.55, 0.42],
};

describe("physical track hazards", () => {
  it("replaces only track bodies, preserves the roster and validates before replacement", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      const initial = physics.metrics.bodies;
      const roster = physics.activeVehicleIds;
      for (let round = 0; round < 10; round += 1) {
        physics.setTrackBarrels([{ ...barrel, id: `track-barrel:test:${round}` }]);
        expect(physics.metrics.bodies).toBe(initial + 1);
      }
      const before = physics.sceneObjects;
      expect(() => physics.setTrackBarrels([{ ...barrel, rotation: [0, 0, 0, 0] }])).toThrow();
      expect(() => physics.setTrackBarrels([barrel, barrel])).toThrow();
      expect(physics.sceneObjects).toEqual(before);
      expect(physics.activeVehicleIds).toEqual(roster);
      physics.setTrackBarrels([]);
      expect(physics.metrics.bodies).toBe(initial);
      expect(physics.sceneObjects).toHaveLength(4);
    } finally { physics.dispose(); }
  });

  it("preserves full rotation, ray hits and reset placement for a fallen barrel", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus(), 1 / 60, undefined, { collisionObjects: false });
    try {
      const fallen = { ...barrel, rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const };
      physics.setTrackBarrels([fallen]);
      physics.step(1 / 60);
      expect(physics.castProjectileSegment([-4, 0.55, 5], [-4, 0.55, 9])?.objectId).toBe(barrel.id);
      physics.impactSceneObject(barrel.id, [0, 0, 100], true);
      expect(physics.sceneObjects[0]!.active).toBe(false);
      physics.resetDemo();
      expect(physics.sceneObjects[0]!.active).toBe(true);
      physics.sceneObjects[0]!.history.current.position.forEach((value, axis) => expect(value).toBeCloseTo(fallen.position[axis]!));
      expect(physics.sceneObjects[0]!.history.current.rotation[0]).toBeCloseTo(Math.SQRT1_2);
    } finally { physics.dispose(); }
  });

  it("replays real prop destruction, delayed chain and combat damage at 30/60/120 Hz", async () => {
    const replay = async (hz: number) => {
      const events = new RuntimeEventBus();
      const physics = await createPhysicsRuntime(events, 1 / 60, undefined, { collisionObjects: false });
      try {
        const specs = [barrel, { ...barrel, id: "track-barrel:test:1", position: [-1, 0.55, 7] as const }];
        physics.setTrackBarrels(specs);
        const runtime = new TrackHazardRuntime(specs.map((spec) => ({ id: spec.id, position: spec.position, ...ALPHA_BARREL_EXPLOSION })), physics);
        const combat = new CombatSession({ players: [{ id: PRIMARY_VEHICLE_ID }], pickups: [] });
        events.subscribe((event) => {
          if (event.type === "physics:object-destroyed") runtime.recordImpact({ id: event.id, position: event.position });
        });
        const clock = new FixedStepClock({ stepSeconds: 1 / 60 });
        const timeline: unknown[] = [];
        let step = 0;
        const simulate = (dt: number) => {
          if (step++ === 5) physics.impactSceneObject(barrel.id, [0, 0, 1], true);
          const result = runtime.advance(dt, combat, { [PRIMARY_VEHICLE_ID]: { position: [-3, 0.55, 7], headingRadians: 0 } });
          timeline.push(...result.hazardEvents, ...result.combatEvents);
          physics.step(dt);
        };
        clock.advance(0, simulate);
        for (let frame = 1; frame <= hz * 2; frame += 1) clock.advance(frame / hz, simulate);
        expect(combat.snapshot.players[0]!.destroyed).toBe(true);
        expect(runtime.snapshot.hazards.every((hazard) => hazard.phase === "spent")).toBe(true);
        const paused = runtime.snapshot;
        // No advance calls during pause: inspection and presentation cannot tick a fuse.
        expect(runtime.snapshot).toEqual(paused);
        runtime.recordImpact({ id: barrel.id, position: barrel.position });
        physics.resetDemo(); runtime.reset();
        expect(runtime.advance(1 / 60, combat, {}).hazardEvents).toEqual([]);
        expect(physics.sceneObjects.every((object) => object.active)).toBe(true);
        return { step, timeline, objects: physics.sceneObjects };
      } finally { physics.dispose(); }
    };
    expect(await replay(30)).toEqual(await replay(60));
    expect(await replay(120)).toEqual(await replay(60));
  });
});
