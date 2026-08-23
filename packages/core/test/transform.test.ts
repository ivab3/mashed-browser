import { describe, expect, it } from "vitest";

import { interpolateTransform } from "../src/index.js";

describe("interpolateTransform", () => {
  it("interpolates positions and normalizes quaternion output", () => {
    const result = interpolateTransform(
      { position: [0, 2, 4], rotation: [0, 0, 0, 1] },
      { position: [10, 4, 0], rotation: [0, 1, 0, 0] },
      0.5,
    );
    expect(result.position).toEqual([5, 3, 2]);
    expect(Math.hypot(...result.rotation)).toBeCloseTo(1);
  });
});
