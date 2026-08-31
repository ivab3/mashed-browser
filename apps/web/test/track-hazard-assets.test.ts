import { describe, expect, it } from "vitest";
import { parseCourseLua, type DffModel, type MtsMatrix } from "@mashed/assets";
import { TrackHazardAssets } from "../src/track-hazard-assets.js";

const course = parseCourseLua(`Course_Id(33)
  Clump_Filename(1, "RBarrel.dff")
  Mts_Filename(2, "RBarrel.mts")
  ExpObj_Clump_Mts_Pair(1, 2)`);
const matrix: MtsMatrix = { right: [1, 0, 0], up: [0, 0, -1], at: [0, 1, 0], position: [10, 2, 3], flags: 3, libraryId: 1 };
const model: DffModel = {
  libraryId: 1,
  frames: [{ right: [1, 0, 0], up: [0, 1, 0], at: [0, 0, 1], position: [0, 0, 0], parentIndex: -1, flags: 0 }],
  atomics: [{ frameIndex: 0, geometryIndex: 0, flags: 0 }],
  geometries: [{ format: 2, vertexCount: 2, triangleCount: 0, uvSets: [], indices: new Uint32Array(),
    triangleMaterialIndices: new Uint16Array(), materials: [], userData: [],
    morphTargets: [{ boundingSphere: [0, 1, 0, 2], positions: new Float32Array([-0.5, 0, -0.5, 0.5, 2, 0.5]) }] }],
};

function assets() {
  const cache = new TrackHazardAssets();
  cache.remember("RBARREL.DFF", { kind: "dff", data: model });
  cache.remember("RBARREL.MTS", { kind: "mts", data: { matrices: [matrix] } });
  return cache;
}

describe("course-scoped track hazards", () => {
  it("uses source translation/rotation and local model bounds without vehicle scaling", () => {
    const result = assets().bind(course);
    expect(result.warnings).toEqual([]);
    expect(result.barrels[0]).toMatchObject({ id: "track-barrel:33:1:2:0", position: [10, 2, 2], halfExtents: [0.5, 1, 0.5] });
    expect(result.barrels[0]!.rotation[0]).toBeCloseTo(-Math.SQRT1_2);
    expect(result.models[0]!.center).toEqual([0, 1, 0]);
    expect(result.hazards[0]!.position).toEqual(result.barrels[0]!.position);
  });

  it("reports missing/unsupported data and never reuses instances after a course change", () => {
    const cache = assets();
    cache.clear();
    cache.remember("RBARREL.DFF", { kind: "dff", data: model });
    expect(cache.bind(course).barrels).toEqual([]);
    expect(cache.bind(course).warnings.join()).toContain("RBarrel.mts");
    const hut = parseCourseLua(`Course_Id(33)\nClump_Filename(1,"hut.dff")\nMts_Filename(2,"hut.mts")\nExpObj_Clump_Mts_Pair(1,2)`);
    expect(cache.bind(hut).warnings.join()).toContain("unsupported explosive object");
    expect(cache.bind({ ...course, id: 999 }).warnings.join()).toContain("not admitted");
  });

  it("fails closed on unsupported scaled/sheared/reflected transforms", () => {
    const cache = assets();
    for (const right of [[2, 0, 0], [-1, 0, 0], [1, 0.2, 0]] as const) {
      cache.remember("RBARREL.MTS", { kind: "mts", data: { matrices: [{ ...matrix, right }] } });
      expect(() => cache.bind(course)).toThrow("unsupported");
    }
  });
});
