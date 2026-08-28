import { describe, expect, it } from "vitest";

import {
  createLocalPlayerGrid,
  LOCAL_PLAYER_SLOTS,
} from "../src/index.js";

describe("local player roster", () => {
  it("defines four stable player, vehicle, and gamepad slots", () => {
    expect(LOCAL_PLAYER_SLOTS).toEqual([
      { id: "vehicle-one", label: "P1", gamepadIndex: 0 },
      { id: "vehicle-two", label: "P2", gamepadIndex: 1 },
      { id: "vehicle-three", label: "P3", gamepadIndex: 2 },
      { id: "vehicle-four", label: "P4", gamepadIndex: 3 },
    ]);
  });

  it("centers one or two cars and puts a full roster into a two-by-two grid", () => {
    const anchor = { position: [10, 1, 20] as const, headingRadians: 0 };
    expect(createLocalPlayerGrid(anchor, 1).map((slot) => slot.spawn.position)).toEqual([
      [10, 1, 20],
    ]);
    expect(createLocalPlayerGrid(anchor, 2).map((slot) => slot.spawn.position)).toEqual([
      [9.1, 1, 20],
      [10.9, 1, 20],
    ]);
    expect(createLocalPlayerGrid(anchor, 4).map((slot) => slot.spawn.position)).toEqual([
      [9.1, 1, 20],
      [10.9, 1, 20],
      [9.1, 1, 17.2],
      [10.9, 1, 17.2],
    ]);
  });

  it("rotates lateral and trailing offsets with the authored track heading", () => {
    const grid = createLocalPlayerGrid({
      position: [0, 2, 0],
      headingRadians: Math.PI / 2,
    }, 3);
    expect(grid[0]!.spawn.position[2]).toBeCloseTo(0.9);
    expect(grid[1]!.spawn.position[2]).toBeCloseTo(-0.9);
    expect(grid[2]!.spawn.position[0]).toBeCloseTo(-2.8);
    expect(grid[2]!.spawn.position[2]).toBeCloseTo(0);
  });

  it("rejects invalid player counts and grid data", () => {
    const anchor = { position: [0, 1, 0] as const, headingRadians: 0 };
    expect(() => createLocalPlayerGrid(anchor, 0)).toThrow(/between 1 and 4/);
    expect(() => createLocalPlayerGrid(anchor, 5)).toThrow(/between 1 and 4/);
    expect(() => createLocalPlayerGrid(anchor, 2, {
      columns: 2,
      lateralSpacingMeters: 0,
      longitudinalSpacingMeters: 2,
    })).toThrow(/spacing/);
  });
});
