import { describe, expect, it } from "vitest";

import {
  COMBAT_WEAPON_CONFIGS,
  CombatSession,
  type CombatPlayerFrames,
} from "../src/index.js";

const players = [{ id: "p1", displayName: "P1" }, { id: "p2", displayName: "P2" }];

function frames(p1Z = 0, p2Z = 20): CombatPlayerFrames {
  return {
    p1: { position: [0, 0, p1Z], headingRadians: 0 },
    p2: { position: [0, 0, p2Z], headingRadians: Math.PI },
  };
}

describe("CombatSession", () => {
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

  it("rejects invalid roster, pickup, and frame data", () => {
    expect(() => new CombatSession({ players: [], pickups: [] })).toThrow(/between 1 and 4/);
    expect(() => new CombatSession({
      players,
      pickups: [
        { id: "same", weapon: "rocket", position: [0, 0, 0] },
        { id: "same", weapon: "mine", position: [1, 0, 0] },
      ],
    })).toThrow(/duplicated/);
    const combat = new CombatSession({ players, pickups: [] });
    expect(() => combat.advance(0, frames())).toThrow(/stepSeconds/);
    expect(() => combat.advance(0.1, { missing: { position: [0, 0, 0], headingRadians: 0 } }))
      .toThrow(/Unknown combat player/);
  });
});
