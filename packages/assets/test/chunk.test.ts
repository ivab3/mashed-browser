import { describe, expect, it } from "vitest";

import { BinaryView, readChunkHeader, RenderWareParseError } from "../src/renderware/chunk.js";

function chunk(id: number, payload: Uint8Array, libraryId = 0x1c02000a): Uint8Array {
  const result = new Uint8Array(12 + payload.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, id, true);
  view.setUint32(4, payload.length, true);
  view.setUint32(8, libraryId, true);
  result.set(payload, 12);
  return result;
}

describe("RenderWare chunk reader", () => {
  it("reads a bounded little-endian chunk", () => {
    const input = chunk(0x10, new Uint8Array([1, 2, 3]));
    expect(readChunkHeader(new BinaryView(input), 0)).toEqual({
      id: 0x10,
      name: "clump",
      offset: 0,
      dataOffset: 12,
      length: 3,
      endOffset: 15,
      libraryId: 0x1c02000a,
    });
  });

  it("rejects a chunk that escapes its parent boundary", () => {
    const input = chunk(0x10, new Uint8Array(4));
    expect(() => readChunkHeader(new BinaryView(input), 0, 15)).toThrow(RenderWareParseError);
  });
});
