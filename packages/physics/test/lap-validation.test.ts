import { describe, expect, it } from "vitest";

import { createRouteEscapeInput, createRouteInput } from "../src/lap-validation.js";

const checkpoint = {
  id: 1,
  center: [10, 0, 0] as const,
  triangles: [[
    [10, -1, -2],
    [10, 1, -2],
    [10, 1, 2],
  ]] as const,
};

describe("lap route driver", () => {
  it("steers toward the next checkpoint without recovery input", () => {
    const input = createRouteInput({
      position: [0, 0, 0],
      headingRadians: 0,
      speedMetersPerSecond: 2,
      checkpoint,
      followingCheckpoint: { ...checkpoint, id: 2, center: [20, 0, 0] },
    });

    expect(input.drive).toBe(1);
    expect(input.steer).toBe(1);
    expect(input.recover).toBe(false);
  });

  it("brakes before a sharp corner", () => {
    const input = createRouteInput({
      position: [0, 0, 0],
      headingRadians: Math.PI / 2,
      speedMetersPerSecond: 10,
      checkpoint,
      followingCheckpoint: { ...checkpoint, id: 2, center: [10, 0, 10] },
    });

    expect(input.drive).toBe(0);
    expect(input.brake).toBeGreaterThan(0.5);
    expect(input.recover).toBe(false);
  });

  it("backs away from a persistent obstacle without requesting recovery", () => {
    expect(createRouteEscapeInput()).toMatchObject({
      drive: -0.75,
      steer: 0,
      recover: false,
    });
  });
});
