import { describe, expect, it } from "vitest";

import {
  AiRouteDriver,
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
    expect(Math.abs(input.steer)).toBe(0.45);
    expect(input.recover).toBe(false);
    expect(driver.snapshot.escapeSecondsRemaining).toBeGreaterThan(0);
  });

  it("rejects invalid time and telemetry", () => {
    const driver = new AiRouteDriver({ seed: 1 });
    expect(() => driver.advance(0, routeState())).toThrow(/stepSeconds/);
    expect(() => driver.advance(1 / 60, routeState({ speedMetersPerSecond: Number.NaN })))
      .toThrow(/finite/);
    expect(() => driver.advance(1 / 60, routeState({ speedMetersPerSecond: -1 })))
      .toThrow(/cannot be negative/);
  });
});
