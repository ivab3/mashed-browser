import { describe, expect, it } from "vitest";

import {
  COMBAT_WEAPON_CONFIGS,
  CombatSession,
  type CombatPlayerFrames,
} from "../src/index.js";

const players = [{ id: "p1", displayName: "P1" }, { id: "p2", displayName: "P2" }];
const alphaWeapons = [
  "machine-gun",
  "guided-missile",
  "mortar",
  "rear-flame",
  "oil",
  "proximity-mine",
  "drum-bomb",
  "shotgun",
  "flash",
] as const;

function frames(p1Z = 0, p2Z = 20): CombatPlayerFrames {
  return {
    p1: { position: [0, 0, p1Z], headingRadians: 0 },
    p2: { position: [0, 0, p2Z], headingRadians: Math.PI },
  };
}

describe("CombatSession", () => {
  it("applies environmental damage in 3D without inventing a player owner", () => {
    const combat = new CombatSession({ players, pickups: [{ id: "gun", weapon: "machine-gun", position: [0, 0, 0] }] });
    combat.advance(1 / 60, frames());
    const blast = { id: "barrel", position: [0, 0, 0] as const, radiusMeters: 5, damage: 55, knockbackImpulse: 9000 };
    const first = combat.applyEnvironmentBlast(blast, { ...frames(), p2: { position: [0, 6, 0], headingRadians: 0 } });
    expect(first).toEqual([{ type: "environment-damaged", playerId: "p1", hazardId: "barrel",
      damage: 55, healthRemaining: 45, knockbackImpulse: [0, 1440, 9000] }]);
    expect(combat.applyEnvironmentBlast(blast, frames())).toMatchObject([
      { type: "environment-damaged", damage: 45, healthRemaining: 0 },
      { type: "environment-destroyed", playerId: "p1", hazardId: "barrel" },
    ]);
    expect(combat.snapshot.players[0]).toMatchObject({ destroyed: true, inventory: null, effects: [] });
    expect(combat.applyEnvironmentBlast(blast, frames())).toEqual([]);
    expect(combat.snapshot.players[1]!.health).toBe(100);
  });

  it("validates an entire blast before mutating any player", () => {
    const combat = new CombatSession({ players, pickups: [] });
    const blast = { id: "barrel", position: [0, 0, 0] as const, radiusMeters: 5, damage: 55, knockbackImpulse: 9000 };
    const before = combat.snapshot;
    expect(() => combat.applyEnvironmentBlast({ ...blast, damage: Infinity }, frames())).toThrow();
    expect(() => combat.applyEnvironmentBlast(blast, { ...frames(), p2: { position: [NaN, 0, 0], headingRadians: 0 } })).toThrow();
    expect(() => combat.applyEnvironmentBlast(blast, { unknown: frames().p1 })).toThrow();
    expect(combat.snapshot).toEqual(before);
  });
  it("collects a stable pickup and respawns it on fixed-step time", () => {
    const combat = new CombatSession({
      players,
      pickups: [{ id: "gun", weapon: "machine-gun", position: [0, 0, 0] }],
      pickupRespawnSeconds: 1,
    });
    expect(combat.advance(0.1, frames())).toEqual([{
      type: "pickup-collected",
      pickupId: "gun",
      playerId: "p1",
      weapon: "machine-gun",
      ammo: 12,
    }]);
    expect(combat.snapshot.players[0]?.inventory).toEqual({ weapon: "machine-gun", ammo: 12 });
    expect(combat.advance(0.6, frames(5))).toEqual([]);
    expect(combat.advance(0.4, frames(5))).toContainEqual({ type: "pickup-respawned", pickupId: "gun" });
    expect(combat.snapshot.pickups[0]?.active).toBe(true);
  });

  it("honors a source-authored respawn duration per pickup", () => {
    const combat = new CombatSession({
      players,
      pickups: [{
        id: "gun",
        weapon: "machine-gun",
        position: [0, 0, 0],
        respawnSeconds: 0.25,
      }],
      pickupRespawnSeconds: 10,
    });
    combat.advance(0.1, frames());
    expect(combat.snapshot.pickups[0]?.respawnSecondsRemaining).toBe(0.25);
    combat.advance(0.25, frames(5));
    expect(combat.snapshot.pickups[0]?.active).toBe(true);
  });

  it("fires machine-gun, rocket, and mine projectiles with data-driven ammo", () => {
    const combat = new CombatSession({
      players: [...players, { id: "p3" }],
      pickups: [
        { id: "gun", weapon: "machine-gun", position: [0, 0, 0] },
        { id: "rocket", weapon: "rocket", position: [10, 0, 0] },
        { id: "mine", weapon: "mine", position: [20, 0, 0] },
      ],
    });
    const threeFrames = {
      p1: { position: [0, 0, 0] as const, headingRadians: 0 },
      p2: { position: [10, 0, 0] as const, headingRadians: 0 },
      p3: { position: [20, 0, 0] as const, headingRadians: 0 },
    };
    combat.advance(0.01, threeFrames);
    const events = combat.advance(0.01, threeFrames, { p1: true, p2: true, p3: true });
    expect(events.filter((event) => event.type === "weapon-fired").map((event) => event.weapon))
      .toEqual(["machine-gun", "rocket", "mine"]);
    expect(combat.snapshot.projectiles.map((projectile) => projectile.weapon))
      .toEqual(["machine-gun", "rocket", "mine"]);
    expect(combat.snapshot.players.map((player) => player.inventory?.ammo)).toEqual([
      COMBAT_WEAPON_CONFIGS["machine-gun"].ammo - 1,
      COMBAT_WEAPON_CONFIGS.rocket.ammo - 1,
      COMBAT_WEAPON_CONFIGS.mine.ammo - 1,
    ]);
    expect(combat.snapshot.projectiles.find((projectile) => projectile.weapon === "mine")?.velocity)
      .toEqual([0, 0, 0]);
  });

  it("gives every alpha weapon a distinct deterministic delivery profile", () => {
    for (const weapon of alphaWeapons) {
      const combat = new CombatSession({
        players: [{ id: "p1" }],
        pickups: [{ id: weapon, weapon, position: [0, 0, 0] }],
      });
      combat.advance(0.01, { p1: { position: [0, 0, 0], headingRadians: 0 } });
      const events = combat.advance(
        0.01,
        { p1: { position: [0, 0, 0], headingRadians: 0 } },
        { p1: true },
      );
      expect(events).toContainEqual(expect.objectContaining({
        type: "weapon-fired",
        playerId: "p1",
        weapon,
      }));
      expect(combat.snapshot.players[0]?.inventory?.ammo ?? 0)
        .toBe(Math.max(0, COMBAT_WEAPON_CONFIGS[weapon].ammo - 1));
      expect(combat.snapshot.projectiles[0]?.weapon).toBe(weapon);
    }
  });

  it("steers a guided missile toward the nearest target and applies mortar gravity", () => {
    const guided = new CombatSession({
      players,
      pickups: [{ id: "guided", weapon: "guided-missile", position: [0, 0, 0] }],
    });
    const targetToTheRight: CombatPlayerFrames = {
      p1: { position: [0, 0, 0], headingRadians: 0 },
      p2: { position: [10, 0, 10], headingRadians: 0 },
    };
    guided.advance(0.01, targetToTheRight);
    guided.advance(0.1, targetToTheRight, { p1: true });
    expect(guided.snapshot.projectiles[0]?.velocity[0]).toBeGreaterThan(0);

    const mortar = new CombatSession({
      players,
      pickups: [{ id: "mortar", weapon: "mortar", position: [0, 0, 0] }],
    });
    mortar.advance(0.01, frames());
    mortar.advance(0.1, frames(), { p1: true });
    expect(mortar.snapshot.projectiles[0]?.velocity[1]).toBeCloseTo(6.2);
  });

  it("applies and expires oil and flash handling effects on fixed-step time", () => {
    const oil = new CombatSession({
      players,
      pickups: [{ id: "oil", weapon: "oil", position: [0, 0, 0] }],
    });
    const oilFrames: CombatPlayerFrames = {
      p1: { position: [0, 0, 0], headingRadians: 0 },
      p2: { position: [0, 0, -1.9], headingRadians: 0 },
    };
    oil.advance(0.01, oilFrames);
    const oilEvents = oil.advance(0.3, oilFrames, { p1: true });
    expect(oilEvents).toContainEqual({
      type: "player-affected",
      playerId: "p2",
      sourcePlayerId: "p1",
      weapon: "oil",
      effect: "oiled",
      durationSeconds: 3.5,
    });
    expect(oil.snapshot.players[1]?.effects[0]).toMatchObject({ type: "oiled" });
    oil.advance(3.5, frames(20, 30));
    expect(oil.snapshot.players[1]?.effects).toEqual([]);

    const flash = new CombatSession({
      players,
      pickups: [{ id: "flash", weapon: "flash", position: [0, 0, 0] }],
    });
    flash.advance(0.01, frames(0, 5));
    const flashEvents = flash.advance(0.01, frames(0, 5), { p1: true });
    expect(flashEvents).toContainEqual(expect.objectContaining({
      type: "player-affected",
      playerId: "p2",
      effect: "flashed",
    }));
    expect(flash.snapshot.players[1]?.health).toBe(100);
  });

  it("emits a forward boost when the rear flame is fired", () => {
    const combat = new CombatSession({
      players,
      pickups: [{ id: "flame", weapon: "rear-flame", position: [0, 0, 0] }],
    });
    combat.advance(0.01, frames());
    expect(combat.advance(0.01, frames(), { p1: true })).toContainEqual({
      type: "weapon-boosted",
      playerId: "p1",
      weapon: "rear-flame",
      impulse: [0, 64, 1600],
    });
  });

  it("emits damage, knockback, and destruction from a swept projectile hit", () => {
    const combat = new CombatSession({
      players,
      pickups: [{ id: "rocket", weapon: "rocket", position: [0, 0, 0] }],
      maximumHealth: 30,
    });
    combat.advance(0.01, frames(0, 3.4));
    combat.advance(0.01, frames(0, 3.4), { p1: true });
    const events = combat.advance(0.01, frames(0, 3.4));
    expect(events.map((event) => event.type)).toEqual(["player-damaged", "player-destroyed"]);
    expect(events[0]).toMatchObject({
      playerId: "p2",
      sourcePlayerId: "p1",
      weapon: "rocket",
      damage: 30,
      healthRemaining: 0,
    });
    expect(events[0]?.type === "player-damaged" ? events[0].knockbackImpulse[2] : 0).toBeGreaterThan(0);
    expect(combat.snapshot.players).toMatchObject([
      { id: "p1", health: 30, destroyed: false },
      { id: "p2", health: 0, destroyed: true },
    ]);
    expect(combat.snapshot.projectiles).toEqual([]);
  });

  it("replays the same pickup and projectile tape to an identical snapshot", () => {
    const run = () => {
      const combat = new CombatSession({
        players,
        pickups: [{ id: "gun", weapon: "machine-gun", position: [0, 0, 0] }],
      });
      for (let step = 0; step < 30; step += 1) {
        combat.advance(1 / 60, frames(0, 8), { p1: step === 1 || step === 10 });
      }
      return combat.snapshot;
    };
    expect(run()).toEqual(run());
  });

  it("stops a swept projectile at deterministic world geometry", () => {
    const combat = new CombatSession({
      players,
      pickups: [{ id: "gun", weapon: "machine-gun", position: [0, 0, 0] }],
    });
    const nearBarrierFrames = frames(0, 2.95);
    combat.advance(1 / 60, nearBarrierFrames);
    const events = combat.advance(1 / 60, nearBarrierFrames, { p1: true }, () => ({
      fraction: 0.25,
      normal: [0, 0, -1],
      objectId: "wall-a",
    }));
    expect(events.map((event) => event.type)).toEqual(["weapon-fired", "projectile-world-impact"]);
    expect(events[1]).toMatchObject({
      projectileId: 1,
      ownerId: "p1",
      weapon: "machine-gun",
      position: [0, 0.45, 2],
      normal: [0, 0, -1],
      objectId: "wall-a",
    });
    expect(combat.snapshot.projectiles).toEqual([]);
    expect(combat.snapshot.players[1]?.health).toBe(100);
  });

  it("applies rocket splash at a world impact without hitting a player behind the wall", () => {
    const combat = new CombatSession({
      players,
      pickups: [{ id: "rocket", weapon: "rocket", position: [0, 0, 0] }],
    });
    const nearbyFrames = frames(0, 5.5);
    combat.advance(1 / 60, nearbyFrames);
    const events = combat.advance(1 / 60, nearbyFrames, { p1: true }, () => ({
      fraction: 0.5,
      normal: [0, 0, -1],
    }));
    expect(events.map((event) => event.type)).toEqual([
      "weapon-fired",
      "projectile-world-impact",
      "player-damaged",
    ]);
    expect(events[2]).toMatchObject({ playerId: "p2", weapon: "rocket", healthRemaining: 62 });
  });

  it("rejects invalid roster, pickup, and frame data", () => {
    expect(() => new CombatSession({ players: [], pickups: [] })).toThrow(/between 1 and 4/);
    expect(() => new CombatSession({
      players,
      pickups: [
        { id: "same", weapon: "rocket", position: [0, 0, 0] },
        { id: "same", weapon: "mine", position: [1, 0, 0] },
      ],
    })).toThrow(/duplicated/);
    expect(() => new CombatSession({
      players,
      pickups: [{ id: "bad", weapon: "rocket", position: [0, 0, 0], respawnSeconds: -1 }],
    })).toThrow(/respawn time/);
    const combat = new CombatSession({ players, pickups: [] });
    expect(() => combat.advance(0, frames())).toThrow(/stepSeconds/);
    expect(() => combat.advance(0.1, { missing: { position: [0, 0, 0], headingRadians: 0 } }))
      .toThrow(/Unknown combat player/);
  });
});
