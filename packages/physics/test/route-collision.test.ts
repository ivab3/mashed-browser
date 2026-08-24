import type { LapCheckpoint } from "@mashed/core";
import { describe, expect, it } from "vitest";

import { deriveRouteCollisionLayers } from "../src/route-collision.js";

function checkpoint(id: number, z: number): LapCheckpoint {
  return {
    id,
    center: [0, 1, z],
    triangles: [
      [[-2, 0, z], [2, 0, z], [-2, 2, z]],
      [[2, 0, z], [2, 2, z], [-2, 2, z]],
    ],
  };
}

describe("deriveRouteCollisionLayers", () => {
  it("keeps scenery out of wheel rays and adds a continuous route support ribbon", () => {
    const layers = deriveRouteCollisionLayers({
      checkpoints: [checkpoint(0, -3), checkpoint(1, 0), checkpoint(2, 3)],
    }, [{
      positions: new Float32Array([
        -5, 0, -5, -5, 0, 5, 5, 0, -5,
        -5, -1, -5, -5, -1, 5, 5, -1, -5,
        4, 0, -5, 4, 2, -5, 4, 0, 5,
      ]),
      indices: new Uint32Array([
        0, 1, 2,
        3, 4, 5,
        6, 7, 8,
      ]),
    }]);

    expect(layers.drive).toHaveLength(2);
    expect(layers.drive[0]!.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(layers.drive[1]!.indices).toHaveLength(18);
    expect(layers.scenery).toHaveLength(1);
    expect(layers.scenery[0]!.indices).toEqual(new Uint32Array([6, 7, 8]));
    for (const height of [...layers.drive[1]!.positions].filter((_, index) => index % 3 === 1)) {
      expect(height).toBeCloseTo(0.02);
    }
  });
});
