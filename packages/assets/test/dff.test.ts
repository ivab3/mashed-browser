import { describe, expect, it } from "vitest";

import { parseDff, RenderWareParseError, RW_CHUNK_IDS } from "../src/index.js";

const LIBRARY_ID = 0x1c02000a;

function bytes(length: number, write: (view: DataView) => void): Uint8Array {
  const result = new Uint8Array(length);
  write(new DataView(result.buffer));
  return result;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function chunk(id: number, ...payload: Uint8Array[]): Uint8Array {
  const data = concat(...payload);
  const header = bytes(12, (view) => {
    view.setUint32(0, id, true);
    view.setUint32(4, data.length, true);
    view.setUint32(8, LIBRARY_ID, true);
  });
  return concat(header, data);
}

function struct(payload: Uint8Array): Uint8Array {
  return chunk(RW_CHUNK_IDS.struct, payload);
}

function extension(...payload: Uint8Array[]): Uint8Array {
  return chunk(RW_CHUNK_IDS.extension, ...payload);
}

function integerUserData(name: string, value: number): Uint8Array {
  const encodedName = new TextEncoder().encode(`${name}\0`);
  return chunk(
    RW_CHUNK_IDS.userData,
    bytes(4 + 4 + encodedName.length + 8 + 4, (view) => {
      view.setUint32(0, 1, true);
      view.setUint32(4, encodedName.length, true);
      new Uint8Array(view.buffer).set(encodedName, 8);
      const typeOffset = 8 + encodedName.length;
      view.setUint32(typeOffset, 1, true);
      view.setUint32(typeOffset + 4, 1, true);
      view.setInt32(typeOffset + 8, value, true);
    }),
  );
}

function minimalDff(): Uint8Array {
  const clumpStruct = struct(bytes(12, (view) => view.setUint32(0, 1, true)));
  const frameStruct = struct(
    bytes(60, (view) => {
      view.setUint32(0, 1, true);
      view.setFloat32(4, 1, true);
      view.setFloat32(20, 1, true);
      view.setFloat32(36, 1, true);
      view.setFloat32(40, 2, true);
      view.setFloat32(44, 3, true);
      view.setFloat32(48, 4, true);
      view.setInt32(52, -1, true);
    }),
  );
  const frameList = chunk(RW_CHUNK_IDS.frameList, frameStruct, extension());

  const geometryStruct = struct(
    bytes(84, (view) => {
      view.setUint32(0, 0x02, true);
      view.setUint32(4, 1, true);
      view.setUint32(8, 3, true);
      view.setUint32(12, 1, true);
      view.setUint16(16, 1, true);
      view.setUint16(18, 0, true);
      view.setUint16(20, 0, true);
      view.setUint16(22, 2, true);
      view.setFloat32(36, 1, true);
      view.setUint32(40, 1, true);
      const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
      positions.forEach((value, index) => view.setFloat32(48 + index * 4, value, true));
    }),
  );
  const materialStruct = struct(
    bytes(28, (view) => {
      view.setUint8(4, 255);
      view.setUint8(5, 128);
      view.setUint8(6, 64);
      view.setUint8(7, 255);
    }),
  );
  const material = chunk(RW_CHUNK_IDS.material, materialStruct, extension());
  const materialListStruct = struct(
    bytes(8, (view) => {
      view.setUint32(0, 1, true);
      view.setInt32(4, -1, true);
    }),
  );
  const materialList = chunk(RW_CHUNK_IDS.materialList, materialListStruct, material);
  const geometry = chunk(
    RW_CHUNK_IDS.geometry,
    geometryStruct,
    materialList,
    extension(integerUserData("0.tv_part_id", 76)),
  );
  const geometryList = chunk(
    RW_CHUNK_IDS.geometryList,
    struct(bytes(4, (view) => view.setUint32(0, 1, true))),
    geometry,
  );
  const atomic = chunk(
    RW_CHUNK_IDS.atomic,
    struct(
      bytes(16, (view) => {
        view.setInt32(0, 0, true);
        view.setInt32(4, 0, true);
        view.setUint32(8, 5, true);
      }),
    ),
    extension(),
  );
  return chunk(RW_CHUNK_IDS.clump, clumpStruct, frameList, geometryList, atomic, extension());
}

describe("DFF parser", () => {
  it("reads frames, geometry, materials, morph targets, and atomics", () => {
    const model = parseDff(minimalDff());
    expect(model.libraryId).toBe(LIBRARY_ID);
    expect(model.frames).toEqual([
      {
        right: [1, 0, 0],
        up: [0, 1, 0],
        at: [0, 0, 1],
        position: [2, 3, 4],
        parentIndex: -1,
        flags: 0,
      },
    ]);
    expect(model.atomics).toEqual([{ frameIndex: 0, geometryIndex: 0, flags: 5 }]);
    expect([...model.geometries[0]!.indices]).toEqual([0, 1, 2]);
    expect([...model.geometries[0]!.morphTargets[0]!.positions!]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(model.geometries[0]!.materials[0]!.color).toEqual([255, 128, 64, 255]);
    expect(model.geometries[0]!.userData).toEqual([
      { name: "0.tv_part_id", type: "int", values: [76] },
    ]);
  });

  it("reports a useful error for a non-clump root", () => {
    const input = minimalDff();
    new DataView(input.buffer).setUint32(0, RW_CHUNK_IDS.world, true);
    expect(() => parseDff(input)).toThrow(RenderWareParseError);
    expect(() => parseDff(input)).toThrow("DFF root expected clump");
  });
});
