import { describe, expect, it } from "vitest";

import { parseBspWorld, parseBspWorldHeader, RW_CHUNK_IDS } from "../src/index.js";

const LIBRARY_ID = 0x1c02000a;

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function bytes(length: number, write: (view: DataView, bytes: Uint8Array) => void): Uint8Array {
  const result = new Uint8Array(length);
  write(new DataView(result.buffer), result);
  return result;
}

function chunk(id: number, ...parts: Uint8Array[]): Uint8Array {
  const payload = concat(...parts);
  return concat(
    bytes(12, (view) => {
      view.setUint32(0, id, true);
      view.setUint32(4, payload.length, true);
      view.setUint32(8, LIBRARY_ID, true);
    }),
    payload,
  );
}

function struct(data: Uint8Array): Uint8Array {
  return chunk(RW_CHUNK_IDS.struct, data);
}

function extension(): Uint8Array {
  return chunk(RW_CHUNK_IDS.extension);
}

function stringChunk(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(`${value}\0`);
  const data = new Uint8Array(Math.ceil(encoded.length / 4) * 4);
  data.set(encoded);
  return chunk(RW_CHUNK_IDS.string, data);
}

function textureReference(name: string, filterAddressing: number): Uint8Array {
  return chunk(
    RW_CHUNK_IDS.texture,
    struct(bytes(4, (view) => view.setUint32(0, filterAddressing, true))),
    stringChunk(name),
    stringChunk(""),
    extension(),
  );
}

function fixture(): Uint8Array {
  const structData = new Uint8Array(64);
  const structView = new DataView(structData.buffer);
  structView.setFloat32(4, -1, true);
  structView.setFloat32(8, -2, true);
  structView.setFloat32(12, -3, true);
  structView.setUint32(16, 120, true);
  structView.setUint32(20, 80, true);
  structView.setUint32(24, 3, true);
  structView.setUint32(28, 4, true);
  structView.setUint32(32, 16, true);
  structView.setUint32(36, 0x40020049, true);
  [10, 20, 30, -10, -20, -30].forEach((value, index) => structView.setFloat32(40 + index * 4, value, true));

  const struct = new Uint8Array(12 + structData.length);
  const structHeader = new DataView(struct.buffer);
  structHeader.setUint32(0, RW_CHUNK_IDS.struct, true);
  structHeader.setUint32(4, structData.length, true);
  structHeader.setUint32(8, 0x1c02000a, true);
  struct.set(structData, 12);

  const world = new Uint8Array(12 + struct.length);
  const worldHeader = new DataView(world.buffer);
  worldHeader.setUint32(0, RW_CHUNK_IDS.world, true);
  worldHeader.setUint32(4, struct.length, true);
  worldHeader.setUint32(8, 0x1c02000a, true);
  world.set(struct, 12);
  return world;
}

function fullWorldFixture(): Uint8Array {
  const worldStruct = struct(
    bytes(64, (view) => {
      view.setUint32(16, 1, true);
      view.setUint32(20, 3, true);
      view.setUint32(24, 1, true);
      view.setUint32(28, 2, true);
      view.setUint32(36, 0x40000049, true);
      [10, 10, 10, -10, -10, -10].forEach((value, index) => view.setFloat32(40 + index * 4, value, true));
    }),
  );
  const material = chunk(
    RW_CHUNK_IDS.material,
    struct(bytes(28, (view, data) => {
      data.set([255, 128, 64, 255], 4);
      view.setUint32(12, 1, true);
      view.setFloat32(16, 1, true);
      view.setFloat32(20, 0.25, true);
      view.setFloat32(24, 0.75, true);
    })),
    textureReference("base", 0x1106),
    chunk(
      RW_CHUNK_IDS.extension,
      chunk(
        RW_CHUNK_IDS.materialEffects,
        bytes(20, (view) => {
          view.setUint32(0, 4, true);
          view.setUint32(4, 4, true);
          view.setUint32(8, 5, true);
          view.setUint32(12, 6, true);
          view.setUint32(16, 1, true);
        }),
        textureReference("shadow", 0x11102),
        bytes(4, (view) => view.setUint32(0, 0, true)),
      ),
    ),
  );
  const materialList = chunk(
    RW_CHUNK_IDS.materialList,
    struct(
      bytes(8, (view) => {
        view.setUint32(0, 1, true);
        view.setInt32(4, -1, true);
      }),
    ),
    material,
  );
  const emptySector = chunk(
    RW_CHUNK_IDS.atomicSector,
    struct(bytes(44, (view) => view.setUint32(36, 0x49, true))),
    extension(),
  );
  const populatedSector = chunk(
    RW_CHUNK_IDS.atomicSector,
    struct(
      bytes(100, (view, data) => {
        view.setUint32(4, 1, true);
        view.setUint32(8, 3, true);
        [1, 1, 1, -1, -1, -1].forEach((value, index) => view.setFloat32(12 + index * 4, value, true));
        view.setUint32(36, 0x49, true);
        [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => view.setFloat32(44 + index * 4, value, true));
        data.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255], 80);
        view.setUint16(92, 0, true);
        view.setUint16(94, 1, true);
        view.setUint16(96, 2, true);
        view.setUint16(98, 0, true);
      }),
    ),
    extension(),
  );
  const plane = chunk(
    RW_CHUNK_IDS.planeSector,
    struct(
      bytes(24, (view) => {
        view.setFloat32(4, 0.5, true);
        view.setUint32(8, 1, true);
        view.setUint32(12, 1, true);
        view.setFloat32(16, 1, true);
        view.setFloat32(20, -1, true);
      }),
    ),
    emptySector,
    populatedSector,
  );
  return chunk(RW_CHUNK_IDS.world, worldStruct, materialList, plane, extension());
}

describe("BSP world header parser", () => {
  it("reads geometry counts, format, origin, and bounds", () => {
    expect(parseBspWorldHeader(fixture())).toEqual({
      libraryId: 0x1c02000a,
      rootIsWorldSector: false,
      inverseWorldOrigin: [-1, -2, -3],
      triangleCount: 120,
      vertexCount: 80,
      planeSectorCount: 3,
      worldSectorCount: 4,
      collisionSectorSize: 16,
      format: 0x40020049,
      boundingBoxMaximum: [10, 20, 30],
      boundingBoxMinimum: [-10, -20, -30],
    });
  });

  it("walks plane sectors and reads world-sector geometry", () => {
    const world = parseBspWorld(fullWorldFixture());
    expect(world.materials[0]!.color).toEqual([255, 128, 64, 255]);
    expect(world.materials[0]).toMatchObject({
      flags: 0,
      unused: 0,
      surfaceProperties: { ambient: 1, specular: 0.25, diffuse: 0.75 },
      texture: {
        name: "base",
        filterAddressing: 0x1106,
        filterMode: 6,
        addressU: 1,
        addressV: 1,
        usesMipmaps: true,
        autoMipmaps: true,
      },
      effects: {
        type: 4,
        effects: [
          {
            type: "dual",
            sourceBlend: 5,
            destinationBlend: 6,
            texture: { name: "shadow", filterAddressing: 0x11102 },
          },
          { type: "nothing" },
        ],
      },
    });
    expect(world.rootSector).toMatchObject({ kind: "plane", axis: 0, splitValue: 0.5 });
    expect(world.worldSectors).toHaveLength(2);
    expect(world.worldSectors[0]).toMatchObject({ vertexCount: 0, triangleCount: 0 });
    expect([...world.worldSectors[1]!.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect([...world.worldSectors[1]!.indices]).toEqual([0, 1, 2]);
    expect([...world.worldSectors[1]!.triangleMaterialIndices]).toEqual([0]);
    expect([...world.worldSectors[1]!.colors!]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
    ]);
  });
});
