import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  buildRenderWareTrack,
  type RenderWareTrackMaterial,
  type RenderWareTrackTextureDictionary,
  type RenderWareTrackWorld,
} from "../src/renderware-track.js";

const FILTER_LINEAR = 2;
const ADDRESS_MIRROR = 2;
const ADDRESS_CLAMP = 3;

function material(textureName: string): RenderWareTrackMaterial {
  return {
    color: [255, 255, 255, 255],
    surfaceProperties: { specular: 0 },
    texture: {
      name: textureName,
    },
  };
}

function world(): RenderWareTrackWorld {
  return {
    header: { format: 0x04 },
    materials: [material("road"), material("missing")],
    worldSectors: [{
      index: 0,
      vertexCount: 4,
      triangleCount: 2,
      positions: new Float32Array([
        -1, 0, -1,
        1, 0, -1,
        1, 0, 1,
        -1, 0, 1,
      ]),
      uvSets: [new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])],
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      triangleMaterialIndices: new Uint16Array([1, 0]),
    }],
  };
}

function dictionary(): RenderWareTrackTextureDictionary {
  return {
    textures: [{
      name: "ROAD",
      filterFlags: FILTER_LINEAR | (ADDRESS_MIRROR << 8) | (ADDRESS_CLAMP << 12),
      mipmaps: [{
        width: 1,
        height: 1,
        alphaMode: "mask",
        rgba: new Uint8Array([255, 128, 64, 0]),
      }],
    }],
  };
}

describe("RenderWare track meshes", () => {
  it("binds TXD textures case-insensitively and groups triangles by BSP material", () => {
    const track = buildRenderWareTrack(world(), dictionary());
    expect(track.triangleCount).toBe(2);
    expect(track.materialCount).toBe(2);
    expect(track.textureCount).toBe(1);
    expect(track.missingTextureNames).toEqual(["missing"]);

    const mesh = track.root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.Material[]>;
    expect(mesh.geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ]);
    expect([...mesh.geometry.index!.array]).toEqual([0, 2, 3, 0, 1, 2]);

    const road = mesh.material[0] as THREE.MeshBasicMaterial;
    expect(road.map?.name).toBe("ROAD");
    expect(road.alphaTest).toBe(0.5);
    expect(road.map?.wrapS).toBe(THREE.MirroredRepeatWrapping);
    expect(road.map?.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });
});
