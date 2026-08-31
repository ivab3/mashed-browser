import { describe, expect, it } from "vitest";

import {
  AiRouteDriver,
  createAiNavigationTargets,
  selectAiWeaponTarget,
  type AiDifficulty,
  type AiRouteDriverState,
  type LapCheckpoint,
} from "../src/index.js";

function checkpoint(id: number, x: number, z: number): LapCheckpoint {
  return {
    id,
    center: [x, 0, z],
    triangles: [[
      [x - 2, -1, z],
      [x + 2, -1, z],
      [x, 1, z],
    ]],
  };
}

function routeState(overrides: Partial<AiRouteDriverState> = {}): AiRouteDriverState {
  return {
    position: [0, 0, 0],
    headingRadians: 0,
    speedMetersPerSecond: 2,
    precedingCheckpoint: checkpoint(0, 0, -10),
    checkpoint: checkpoint(1, 10, 0),
    followingCheckpoint: checkpoint(2, 20, 0),
    ...overrides,
  };
}

describe("AI route driver", () => {
  it("steers toward the next checkpoint through normal vehicle inputs", () => {
    const driver = new AiRouteDriver({ difficulty: "normal", seed: 123 });
    const input = driver.advance(0.1, routeState());
    expect(input).toMatchObject({ drive: 1, steer: -1, recover: false });
  });

  it("uses difficulty profiles for speed and reaction cadence", () => {
    const inputFor = (difficulty: AiDifficulty) => new AiRouteDriver({ difficulty, seed: 1 })
      .advance(0.2, routeState({
        position: [0, 0, 0],
        headingRadians: Math.PI / 2,
        speedMetersPerSecond: 8,
        checkpoint: checkpoint(1, 10, 0),
        followingCheckpoint: checkpoint(2, 20, 0),
      }));
    expect(inputFor("easy").brake).toBeGreaterThan(inputFor("hard").brake);

    const easy = new AiRouteDriver({ difficulty: "easy", seed: 1 });
    const initial = easy.advance(0.2, routeState());
    const cached = easy.advance(0.1, routeState({ headingRadians: Math.PI }));
    expect(cached.steer).toBe(initial.steer);
  });

  it("replays identical fixed-step states and seeded item decisions", () => {
    const run = () => {
      const driver = new AiRouteDriver({ difficulty: "hard", seed: 0xa11ce });
      const inputs = Array.from({ length: 300 }, (_, step) => driver.advance(1 / 60, routeState({
        speedMetersPerSecond: 4 + (step % 20) / 10,
        checkpoint: checkpoint(Math.floor(step / 60) + 1, 10 + Math.floor(step / 60) * 8, 0),
      })));
      return { inputs, snapshot: driver.snapshot };
    };
    expect(run()).toEqual(run());
  });

  it("restores its seeded decision stream on reset", () => {
    const driver = new AiRouteDriver({ difficulty: "normal", seed: 42 });
    const first = driver.advance(0.1, routeState());
    const firstSnapshot = driver.snapshot;
    driver.advance(2, routeState({ checkpoint: checkpoint(2, 20, 0) }));
    driver.reset();
    expect(driver.advance(0.1, routeState())).toEqual(first);
    expect(driver.snapshot).toEqual(firstSnapshot);
  });

  it("backs away after remaining stuck without requesting a teleport recovery", () => {
    const driver = new AiRouteDriver({ difficulty: "hard", seed: 9 });
    let input = driver.advance(1, routeState({ speedMetersPerSecond: 0 }));
    input = driver.advance(1, routeState({ speedMetersPerSecond: 0 }));
    input = driver.advance(1, routeState({ speedMetersPerSecond: 0 }));
    expect(input.drive).toBe(-0.75);
    expect(input.steer).toBe(1);
    expect(input.recover).toBe(false);
    expect(driver.snapshot.escapeSecondsRemaining).toBeGreaterThan(0);
  });

  it("backs out of a near-checkpoint obstruction and reverses toward an overshot gate", () => {
    const driver = new AiRouteDriver({ difficulty: "hard", seed: 9 });
    const nearby = routeState({ position: [9, 0, 0], speedMetersPerSecond: 0 });
    for (let step = 0; step < 179; step += 1) driver.advance(1 / 60, nearby);
    expect(driver.advance(1 / 60, nearby).drive).toBe(-0.75);
    const overshot = new AiRouteDriver({ difficulty: "hard", seed: 1 }).advance(1 / 60, routeState({
      position: [12, 0, 0], headingRadians: Math.PI / 2, speedMetersPerSecond: 1,
    }));
    expect(overshot.drive).toBeLessThan(0);
    expect(Math.abs(overshot.steer)).toBeLessThan(0.3);
    expect(overshot.recover).toBe(false);
  });

  it("chooses a clear lane deterministically but avoids lateral alternatives in narrow gates", () => {
    const driver = new AiRouteDriver({ difficulty: "hard", seed: 9 });
    const input = driver.advance(1 / 60, routeState({
      headingRadians: 0,
      navigationTargets: [
        { bias: 0, position: [0, 0, 10], clearance: 0.2 },
        { bias: 0.2, position: [4, 0, 10], clearance: 1 },
      ],
    }));
    expect(input.steer).toBeLessThan(0);
    const narrow: LapCheckpoint = {
      ...checkpoint(1, 0, 10), triangles: [[[-1, -1, 10], [1, -1, 10], [0, 1, 10]]],
    };
    expect(createAiNavigationTargets(routeState({ checkpoint: narrow }))).toEqual([]);
    expect(() => driver.advance(1 / 60, routeState({
      navigationTargets: [{ bias: 0, position: [0, 0, 10], clearance: Number.NaN }],
    }))).toThrow(/clearance/);
  });

  it("selects targets in the useful arc of forward, rear, and radial weapons", () => {
    const opponents = [
      { id: "front", position: [0, 0, 10] as const },
      { id: "rear", position: [0, 0, -5] as const },
      { id: "side", position: [5, 0, 0] as const },
    ];
    const context = { position: [0, 0, 0] as const, headingRadians: 0, opponents, difficulty: "hard" as const };
    expect(selectAiWeaponTarget({ ...context, weapon: "machine-gun" })?.id).toBe("front");
    expect(selectAiWeaponTarget({ ...context, weapon: "oil" })?.id).toBe("rear");
    expect(selectAiWeaponTarget({ ...context, weapon: "shotgun" })?.id).toBe("rear");
  });

  it("does not request an item without a tactical target", () => {
    const driver = new AiRouteDriver({ difficulty: "hard", seed: 2 });
    const inputs = Array.from({ length: 180 }, () => driver.advance(1 / 60, routeState({
      heldWeapon: "machine-gun",
      opponents: [{ id: "behind", position: [0, 0, -5] }],
    })));
    expect(inputs.every((input) => !input.useItem)).toBe(true);
    expect(driver.snapshot.targetPlayerId).toBeNull();
  });

  it("rejects invalid time and telemetry", () => {
    const driver = new AiRouteDriver({ seed: 1 });
    expect(() => driver.advance(0, routeState())).toThrow(/stepSeconds/);
    expect(() => driver.advance(1 / 60, routeState({ speedMetersPerSecond: Number.NaN })))
      .toThrow(/finite/);
    expect(() => driver.advance(1 / 60, routeState({ speedMetersPerSecond: -1 })))
      .toThrow(/cannot be negative/);
    expect(() => driver.advance(1 / 60, routeState({
      opponents: [{ id: "bad", position: [Number.NaN, 0, 0] }],
    }))).toThrow(/position must be finite/);
  });
});
