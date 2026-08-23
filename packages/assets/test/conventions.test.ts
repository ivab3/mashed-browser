import { describe, expect, it } from "vitest";

import {
  analyzeTriangleWinding,
  basisDeterminant,
  MASHED_ASSET_CONVENTIONS,
  textureCoordinateSetCount,
} from "../src/index.js";

describe("Mashed RenderWare conventions", () => {
  it("describes the coordinate and scale conversion used by the runtime", () => {
    expect(MASHED_ASSET_CONVENTIONS).toMatchObject({
      coordinateSystem: { handedness: "right-handed", upAxis: "+y", forwardAxis: "+z" },
      triangleWinding: "counter-clockwise",
      bspToWorldScale: 1,
      dffToWorldScale: 5,
    });
    expect(basisDeterminant([1, 0, 0], [0, 1, 0], [0, 0, 1])).toBe(1);
  });

  it("counts UV sets and detects index winding against vertex normals", () => {
    expect(textureCoordinateSetCount(0x04)).toBe(1);
    expect(textureCoordinateSetCount(0x80)).toBe(2);
    expect(textureCoordinateSetCount(0x0003_0000)).toBe(3);

    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(analyzeTriangleWinding(positions, normals, new Uint32Array([0, 1, 2]))).toEqual({
      aligned: 1,
      opposed: 0,
      degenerate: 0,
    });
    expect(analyzeTriangleWinding(positions, normals, new Uint32Array([0, 2, 1]))).toEqual({
      aligned: 0,
      opposed: 1,
      degenerate: 0,
    });
  });
});
