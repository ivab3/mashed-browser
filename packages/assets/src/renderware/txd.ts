import {
  BinaryView,
  ChunkCursor,
  expectChunk,
  readChunkHeader,
  RenderWareParseError,
  RW_CHUNK_IDS,
  type RenderWareChunkHeader,
} from "./chunk.js";

export interface TxdImage {
  width: number;
  height: number;
  depth: number;
  stride: number;
  pixelFormat: "palette4" | "palette8" | "rgb24" | "rgba32";
  alphaMode: TxdAlphaMode;
  rgba: Uint8Array;
}

export type TxdAlphaMode = "opaque" | "mask" | "blend";

export interface TxdTexture {
  name: string;
  maskName: string;
  filterFlags: number;
  mipmaps: TxdImage[];
}

export interface PiTextureDictionary {
  flags: number;
  textures: TxdTexture[];
}

export interface NativeTextureInspection {
  platform: number;
  structLength: number;
  name?: string;
  rasterFormat?: number;
  hasAlpha?: boolean;
  width?: number;
  height?: number;
  depth?: number;
  mipmapCount?: number;
  compression?: number;
}

export type TextureDictionaryInspection =
  | {
      kind: "platform-independent";
      libraryId: number;
      textureCount: number;
      flags: number;
    }
  | {
      kind: "native";
      libraryId: number;
      textureCount: number;
      deviceId: number;
      textures: NativeTextureInspection[];
    };

export function classifyTextureAlpha(rgba: Uint8Array): TxdAlphaMode {
  let hasZero = false;
  for (let offset = 3; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset]!;
    if (alpha > 0 && alpha < 255) {
      return "blend";
    }
    hasZero ||= alpha === 0;
  }
  return hasZero ? "mask" : "opaque";
}

export function inspectTextureDictionary(input: ArrayBuffer | Uint8Array): TextureDictionaryInspection {
  const view = new BinaryView(input);
  const root = readChunkHeader(view, 0);
  if (root.endOffset !== view.length) {
    throw new RenderWareParseError("Texture dictionary has trailing bytes after its root chunk");
  }
  if (root.id === RW_CHUNK_IDS.piTextureDictionary) {
    if (root.length < 4) {
      throw new RenderWareParseError("PI texture dictionary is too small");
    }
    return {
      kind: "platform-independent",
      libraryId: root.libraryId,
      textureCount: view.u16(root.dataOffset, "texture count"),
      flags: view.u16(root.dataOffset + 2, "texture dictionary flags"),
    };
  }
  expectChunk(root, RW_CHUNK_IDS.textureDictionary, "texture dictionary root");
  const cursor = new ChunkCursor(view, root.dataOffset, root.endOffset, "native texture dictionary");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "native texture dictionary struct");
  if (struct.length !== 4) {
    throw new RenderWareParseError(`Native texture dictionary struct has ${struct.length} bytes, expected 4`);
  }
  const textureCount = view.u16(struct.dataOffset, "native texture count");
  const deviceId = view.u16(struct.dataOffset + 2, "native texture device id");
  const textures: NativeTextureInspection[] = [];
  for (let index = 0; index < textureCount; index += 1) {
    const texture = cursor.expect(RW_CHUNK_IDS.textureNative, `native texture ${index}`);
    const nativeStruct = expectChunk(
      readChunkHeader(view, texture.dataOffset, texture.endOffset),
      RW_CHUNK_IDS.struct,
      `native texture ${index} struct`,
    );
    if (nativeStruct.length < 4) {
      throw new RenderWareParseError(`Native texture ${index} struct is too small`);
    }
    const platform = view.u32(nativeStruct.dataOffset, `native texture ${index} platform`);
    if (platform === 5 && nativeStruct.length >= 92) {
      textures.push({
        platform,
        structLength: nativeStruct.length,
        name: view.ascii(nativeStruct.dataOffset + 8, 32, `native texture ${index} name`),
        rasterFormat: view.u32(nativeStruct.dataOffset + 72, `native texture ${index} raster format`),
        hasAlpha: view.u16(nativeStruct.dataOffset + 76, `native texture ${index} alpha flag`) !== 0,
        width: view.u16(nativeStruct.dataOffset + 80, `native texture ${index} width`),
        height: view.u16(nativeStruct.dataOffset + 82, `native texture ${index} height`),
        depth: view.u8(nativeStruct.dataOffset + 84, `native texture ${index} depth`),
        mipmapCount: view.u8(nativeStruct.dataOffset + 85, `native texture ${index} mip count`),
        compression: view.u8(nativeStruct.dataOffset + 87, `native texture ${index} compression`),
      });
    } else {
      textures.push({ platform, structLength: nativeStruct.length });
    }
  }
  cursor.expect(RW_CHUNK_IDS.extension, "native texture dictionary extension");
  if (!cursor.done) {
    throw new RenderWareParseError("Native texture dictionary contains unexpected trailing chunks");
  }
  return { kind: "native", libraryId: root.libraryId, textureCount, deviceId, textures };
}

function parseTextureMetadata(
  view: BinaryView,
  chunk: RenderWareChunkHeader,
): { name: string; maskName: string; filterFlags: number } {
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "texture metadata");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "texture metadata struct");
  if (struct.length < 4) {
    throw new RenderWareParseError("Texture metadata struct is too small");
  }
  const name = cursor.expect(RW_CHUNK_IDS.string, "texture name");
  const maskName = cursor.expect(RW_CHUNK_IDS.string, "texture mask name");
  cursor.expect(RW_CHUNK_IDS.extension, "texture metadata extension");
  if (!cursor.done) {
    throw new RenderWareParseError("Texture metadata contains unexpected trailing chunks");
  }
  return {
    filterFlags: view.u32(struct.dataOffset, "texture filter flags"),
    name: view.ascii(name.dataOffset, name.length, "texture name"),
    maskName: view.ascii(maskName.dataOffset, maskName.length, "texture mask name"),
  };
}

function decodePalettedImage(
  view: BinaryView,
  pixelOffset: number,
  paletteOffset: number,
  width: number,
  height: number,
  stride: number,
  paletteEntries: number,
): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const paletteIndex = view.u8(pixelOffset + y * stride + x, "palette index");
      if (paletteIndex >= paletteEntries) {
        throw new RenderWareParseError(`Palette index ${paletteIndex} exceeds ${paletteEntries}-entry palette`);
      }
      const source = paletteOffset + paletteIndex * 4;
      const target = (y * width + x) * 4;
      rgba[target] = view.u8(source, "palette red");
      rgba[target + 1] = view.u8(source + 1, "palette green");
      rgba[target + 2] = view.u8(source + 2, "palette blue");
      rgba[target + 3] = view.u8(source + 3, "palette alpha");
    }
  }
  return rgba;
}

function decodeTrueColorImage(
  view: BinaryView,
  pixelOffset: number,
  width: number,
  height: number,
  depth: number,
  stride: number,
): Uint8Array {
  const bytesPerPixel = depth / 8;
  if (bytesPerPixel !== 3 && bytesPerPixel !== 4) {
    throw new RenderWareParseError(`Unsupported ${depth}-bit true-color RenderWare image`);
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = pixelOffset + y * stride + x * bytesPerPixel;
      const target = (y * width + x) * 4;
      rgba[target] = view.u8(source, "pixel red");
      rgba[target + 1] = view.u8(source + 1, "pixel green");
      rgba[target + 2] = view.u8(source + 2, "pixel blue");
      rgba[target + 3] = bytesPerPixel === 4 ? view.u8(source + 3, "pixel alpha") : 255;
    }
  }
  return rgba;
}

function parseImage(view: BinaryView, chunk: RenderWareChunkHeader): TxdImage {
  const struct = expectChunk(readChunkHeader(view, chunk.dataOffset, chunk.endOffset), RW_CHUNK_IDS.struct, "image struct");
  if (struct.length !== 16) {
    throw new RenderWareParseError(`Image struct has ${struct.length} bytes, expected 16`);
  }
  const width = view.u32(struct.dataOffset, "image width");
  const height = view.u32(struct.dataOffset + 4, "image height");
  const depth = view.u32(struct.dataOffset + 8, "image depth");
  const stride = view.u32(struct.dataOffset + 12, "image stride");
  if (width === 0 || height === 0 || width > 16_384 || height > 16_384 || stride < width) {
    throw new RenderWareParseError(`Invalid RenderWare image dimensions ${width}x${height}, stride ${stride}`);
  }
  const pixelOffset = struct.endOffset;
  const pixelBytes = stride * height;
  let rgba: Uint8Array;
  let expectedEnd: number;
  let pixelFormat: TxdImage["pixelFormat"];
  if (depth === 4 || depth === 8) {
    const paletteEntries = 1 << depth;
    const paletteOffset = pixelOffset + pixelBytes;
    expectedEnd = paletteOffset + paletteEntries * 4;
    rgba = decodePalettedImage(view, pixelOffset, paletteOffset, width, height, stride, paletteEntries);
    pixelFormat = depth === 4 ? "palette4" : "palette8";
  } else if (depth === 24 || depth === 32) {
    expectedEnd = pixelOffset + pixelBytes;
    rgba = decodeTrueColorImage(view, pixelOffset, width, height, depth, stride);
    pixelFormat = depth === 24 ? "rgb24" : "rgba32";
  } else {
    throw new RenderWareParseError(`Unsupported RenderWare image depth ${depth}`);
  }
  if (expectedEnd !== chunk.endOffset) {
    throw new RenderWareParseError(
      `Image ${width}x${height}x${depth} ends at 0x${expectedEnd.toString(16)}, expected 0x${chunk.endOffset.toString(16)}`,
    );
  }
  return { width, height, depth, stride, pixelFormat, alphaMode: classifyTextureAlpha(rgba), rgba };
}

export function parsePiTextureDictionary(input: ArrayBuffer | Uint8Array): PiTextureDictionary {
  const view = new BinaryView(input);
  const rootHeader = readChunkHeader(view, 0);
  if (rootHeader.id === RW_CHUNK_IDS.textureDictionary) {
    const inspection = inspectTextureDictionary(input);
    const platforms = inspection.kind === "native"
      ? [...new Set(inspection.textures.map((texture) => `0x${texture.platform.toString(16)}`))].join(", ")
      : "unknown";
    throw new RenderWareParseError(
      `Native texture dictionary (${platforms}) is not supported by the PI decoder; use the non-PS2/Xbox TXD`,
    );
  }
  const root = expectChunk(rootHeader, RW_CHUNK_IDS.piTextureDictionary, "PI texture dictionary root");
  if (root.endOffset !== view.length || root.length < 4) {
    throw new RenderWareParseError("PI texture dictionary has an invalid root boundary");
  }
  const textureCount = view.u16(root.dataOffset, "texture count");
  const flags = view.u16(root.dataOffset + 2, "texture dictionary flags");
  let offset = root.dataOffset + 4;
  const textures: TxdTexture[] = [];
  const names = new Set<string>();
  for (let textureIndex = 0; textureIndex < textureCount; textureIndex += 1) {
    view.assertRange(offset, 4, `texture ${textureIndex} mip count`);
    const mipCount = view.u32(offset, `texture ${textureIndex} mip count`);
    offset += 4;
    if (mipCount === 0 || mipCount > 32) {
      throw new RenderWareParseError(`Texture ${textureIndex} declares invalid mip count ${mipCount}`);
    }
    const mipmaps: TxdImage[] = [];
    for (let mipIndex = 0; mipIndex < mipCount; mipIndex += 1) {
      const image = expectChunk(readChunkHeader(view, offset, root.endOffset), RW_CHUNK_IDS.image, `texture ${textureIndex} mip ${mipIndex}`);
      const parsed = parseImage(view, image);
      const previous = mipmaps.at(-1);
      if (previous) {
        const expectedWidth = Math.max(1, Math.floor(previous.width / 2));
        const expectedHeight = Math.max(1, Math.floor(previous.height / 2));
        if (parsed.width !== expectedWidth || parsed.height !== expectedHeight || parsed.depth !== previous.depth) {
          throw new RenderWareParseError(
            `Texture ${textureIndex} mip ${mipIndex} is ${parsed.width}x${parsed.height}x${parsed.depth}, expected ${expectedWidth}x${expectedHeight}x${previous.depth}`,
          );
        }
      }
      mipmaps.push(parsed);
      offset = image.endOffset;
    }
    const textureChunk = expectChunk(
      readChunkHeader(view, offset, root.endOffset),
      RW_CHUNK_IDS.texture,
      `texture ${textureIndex} metadata`,
    );
    const metadata = parseTextureMetadata(view, textureChunk);
    const normalizedName = metadata.name.toLocaleLowerCase("en-US");
    if (names.has(normalizedName)) {
      throw new RenderWareParseError(`Texture dictionary contains duplicate name ${metadata.name}`);
    }
    names.add(normalizedName);
    textures.push({ ...metadata, mipmaps });
    offset = textureChunk.endOffset;
  }
  if (offset !== root.endOffset) {
    throw new RenderWareParseError(`PI texture dictionary contains ${root.endOffset - offset} trailing bytes`);
  }
  return { flags, textures };
}
