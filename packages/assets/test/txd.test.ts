import { describe, expect, it } from "vitest";

import {
  classifyTextureAlpha,
  inspectTextureDictionary,
  parsePiTextureDictionary,
  RW_CHUNK_IDS,
} from "../src/index.js";

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

function data(length: number, write: (view: DataView, bytes: Uint8Array) => void): Uint8Array {
  const result = new Uint8Array(length);
  write(new DataView(result.buffer), result);
  return result;
}

function chunk(id: number, ...parts: Uint8Array[]): Uint8Array {
  const payload = concat(...parts);
  return concat(
    data(12, (view) => {
      view.setUint32(0, id, true);
      view.setUint32(4, payload.length, true);
      view.setUint32(8, LIBRARY_ID, true);
    }),
    payload,
  );
}

function stringChunk(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(`${value}\0`);
  const padded = new Uint8Array(Math.ceil(encoded.length / 4) * 4);
  padded.set(encoded);
  return chunk(RW_CHUNK_IDS.string, padded);
}

function fixture(): Uint8Array {
  const imageStruct = chunk(
    RW_CHUNK_IDS.struct,
    data(16, (view) => {
      view.setUint32(0, 2, true);
      view.setUint32(4, 1, true);
      view.setUint32(8, 4, true);
      view.setUint32(12, 4, true);
    }),
  );
  const pixels = new Uint8Array([0, 1, 0, 0]);
  const palette = data(16 * 4, (_, bytes) => {
    bytes.set([255, 0, 0, 255], 0);
    bytes.set([0, 255, 0, 128], 4);
  });
  const image = chunk(RW_CHUNK_IDS.image, imageStruct, pixels, palette);
  const texture = chunk(
    RW_CHUNK_IDS.texture,
    chunk(RW_CHUNK_IDS.struct, data(4, (view) => view.setUint32(0, 0x1102, true))),
    stringChunk("Body"),
    stringChunk(""),
    chunk(RW_CHUNK_IDS.extension),
  );
  const header = data(8, (view) => {
    view.setUint16(0, 1, true);
    view.setUint16(2, 1, true);
    view.setUint32(4, 1, true);
  });
  return chunk(RW_CHUNK_IDS.piTextureDictionary, header, image, texture);
}

function xboxNativeFixture(): Uint8Array {
  const nativeStruct = data(92, (view, bytes) => {
    view.setUint32(0, 5, true);
    view.setUint32(4, 0x1104, true);
    bytes.set(new TextEncoder().encode("Badge\0"), 8);
    view.setUint32(72, 0x0500, true);
    view.setUint16(76, 1, true);
    view.setUint16(80, 256, true);
    view.setUint16(82, 128, true);
    view.setUint8(84, 32);
    view.setUint8(85, 4);
    view.setUint8(86, 4);
    view.setUint8(87, 0);
  });
  return chunk(
    RW_CHUNK_IDS.textureDictionary,
    chunk(
      RW_CHUNK_IDS.struct,
      data(4, (view) => {
        view.setUint16(0, 1, true);
        view.setUint16(2, 8, true);
      }),
    ),
    chunk(RW_CHUNK_IDS.textureNative, chunk(RW_CHUNK_IDS.struct, nativeStruct)),
    chunk(RW_CHUNK_IDS.extension),
  );
}

describe("platform-independent TXD parser", () => {
  it("decodes paletted pixels and texture metadata", () => {
    const dictionary = parsePiTextureDictionary(fixture());
    expect(dictionary.flags).toBe(1);
    expect(dictionary.textures).toHaveLength(1);
    expect(dictionary.textures[0]!.name).toBe("Body");
    expect(dictionary.textures[0]!.filterFlags).toBe(0x1102);
    expect(dictionary.textures[0]!.mipmaps[0]).toMatchObject({
      width: 2,
      height: 1,
      depth: 4,
      stride: 4,
      pixelFormat: "palette4",
      alphaMode: "blend",
    });
    expect([...dictionary.textures[0]!.mipmaps[0]!.rgba]).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 128,
    ]);
  });

  it("classifies opaque, binary-mask, and blended alpha", () => {
    expect(classifyTextureAlpha(new Uint8Array([1, 2, 3, 255]))).toBe("opaque");
    expect(classifyTextureAlpha(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0]))).toBe("mask");
    expect(classifyTextureAlpha(new Uint8Array([1, 2, 3, 127]))).toBe("blend");
  });

  it("inspects Xbox native headers without treating them as PI images", () => {
    const native = xboxNativeFixture();
    expect(inspectTextureDictionary(native)).toEqual({
      kind: "native",
      libraryId: LIBRARY_ID,
      textureCount: 1,
      deviceId: 8,
      textures: [{
        platform: 5,
        structLength: 92,
        name: "Badge",
        rasterFormat: 0x0500,
        hasAlpha: true,
        width: 256,
        height: 128,
        depth: 32,
        mipmapCount: 4,
        compression: 0,
      }],
    });
    expect(() => parsePiTextureDictionary(native)).toThrow(/Native texture dictionary.*non-PS2\/Xbox TXD/);
  });
});
