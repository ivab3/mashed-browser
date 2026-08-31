import { describe, expect, it } from "vitest";
import { parseMts } from "../src/index.js";

function fixture(): Uint8Array {
  const bytes = new Uint8Array(80);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1, true);
  for (const [offset, value] of [[4, 13], [8, 64], [12, 0x1c02000a], [16, 1], [20, 52], [24, 0x1c02000a], [76, 3]]) {
    view.setUint32(offset!, value!, true);
  }
  [0, 0, -1, 0, 1, 0, 1, 0, 0, -12, 0.5, 25]
    .forEach((value, index) => view.setFloat32(28 + index * 4, value, true));
  return bytes;
}

describe("MTS instances", () => {
  it("reads rotation, translation and opaque flags from bounded matrix chunks", () => {
    const padded = new Uint8Array(84);
    padded.set(fixture(), 4);
    expect(parseMts(padded.subarray(4))).toEqual({ matrices: [{
      right: [0, 0, -1], up: [0, 1, 0], at: [1, 0, 0], position: [-12, 0.5, 25],
      flags: 3, libraryId: 0x1c02000a,
    }] });
    expect(parseMts(new Uint8Array(4))).toEqual({ matrices: [] });
  });

  it("rejects truncated, mismatched and non-finite input without allocating from an unchecked count", () => {
    for (const [offset, value] of [[0, 0xffffffff], [4, 1], [8, 65], [16, 13], [20, 51], [24, 0], [28, 0x7f800000]]) {
      const bytes = fixture();
      new DataView(bytes.buffer).setUint32(offset!, value!, true);
      expect(() => parseMts(bytes)).toThrow();
    }
    expect(() => parseMts(fixture().subarray(0, 79))).toThrow();
    expect(() => parseMts(new Uint8Array(81))).toThrow();
  });
});
