import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  buildRenderWareModel,
  renderWareFrameMatrices,
  selectIntactVehicleAtomicIndices,
  type RenderWareModel,
} from "../src/renderware-model.js";

function model(frameX: number): RenderWareModel {
  return {
    frames: [
      {
        right: [1, 0, 0],
        up: [0, 1, 0],
        at: [0, 0, 1],
        position: [frameX, 0, 0],
        parentIndex: -1,
      },
      {
        right: [1, 0, 0],
        up: [0, 1, 0],
        at: [0, 0, 1],
        position: [2, 0, 0],
        parentIndex: 0,
      },
    ],
    geometries: [{
      format: 0,
      vertexCount: 3,
      triangleCount: 1,
      uvSets: [],
      indices: new Uint32Array([0, 1, 2]),
      triangleMaterialIndices: new Uint16Array([0]),
      morphTargets: [{
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      }],
      materials: [{ color: [255, 255, 255, 255], surfaceProperties: { specular: 0 } }],
    }],
    atomics: [{ frameIndex: 1, geometryIndex: 0 }],
  };
}

describe("RenderWare DFF model builder", () => {
  it("resolves frame hierarchies and recognizes authored world placement", () => {
    const matrices = renderWareFrameMatrices(model(12).frames);
    expect(new THREE.Vector3().setFromMatrixPosition(matrices[1]!).toArray()).toEqual([14, 0, 0]);

    const built = buildRenderWareModel(model(12), new Map());
    expect(built).toMatchObject({ atomics: 1, triangles: 1, placement: "world-authored" });
    const mesh = built.root.children[0] as THREE.Mesh;
    expect(new THREE.Vector3().setFromMatrixPosition(mesh.matrix).toArray()).toEqual([14, 0, 0]);
  });

  it("keeps small origin-centered models classified as instance templates", () => {
    expect(buildRenderWareModel(model(0), new Map()).placement).toBe("local-template");
  });

  it("keeps intact textured vehicle parts and removes helpers, broken glass, and LOD shells", () => {
    const vehicle = model(0);
    const geometry = vehicle.geometries[0]!;
    const part = (partId: number, texture?: string): typeof geometry => ({
      ...geometry,
      materials: [{
        color: [255, 255, 255, 255],
        surfaceProperties: { specular: 0 },
        ...(texture ? { texture: { name: texture } } : {}),
      }],
      userData: [{ name: "0.tv_part_id", type: "int", values: [partId] }],
    });
    vehicle.geometries = [
      part(21, "Body"),
      part(76, "Glass"),
      part(77, "BrokenGlass"),
      part(25),
      part(100, "BodySmall"),
    ];
    vehicle.atomics = vehicle.geometries.map((_, geometryIndex) => ({ frameIndex: 1, geometryIndex }));
    const selected = selectIntactVehicleAtomicIndices(vehicle);
    expect([...selected]).toEqual([0, 1]);
    expect(buildRenderWareModel(vehicle, new Map(), { atomicIndices: selected })).toMatchObject({
      atomics: 2,
      triangles: 2,
    });
  });
});
