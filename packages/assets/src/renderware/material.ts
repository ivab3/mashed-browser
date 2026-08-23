import {
  BinaryView,
  ChunkCursor,
  expectChunk,
  listExtensionChunks,
  readChunkHeader,
  RenderWareParseError,
  RW_CHUNK_IDS,
  type RenderWareExtensionChunk,
  type RenderWareChunkHeader,
} from "./chunk.js";

export const RW_TEXTURE_FILTER_MODES = {
  nearest: 1,
  linear: 2,
  mipNearest: 3,
  mipLinear: 4,
  linearMipNearest: 5,
  linearMipLinear: 6,
} as const;

export const RW_TEXTURE_ADDRESS_MODES = {
  wrap: 1,
  mirror: 2,
  clamp: 3,
  border: 4,
} as const;

export const RW_MATERIAL_EFFECT_TYPES = {
  nothing: 0,
  bumpMap: 1,
  environmentMap: 2,
  bumpEnvironmentMap: 3,
  dual: 4,
  uvTransform: 5,
  dualUvTransform: 6,
} as const;

export interface RenderWareSurfaceProperties {
  ambient: number;
  specular: number;
  diffuse: number;
}

export interface RenderWareTextureReference {
  name: string;
  maskName: string;
  filterAddressing: number;
  filterMode: number;
  addressU: number;
  addressV: number;
  usesMipmaps: boolean;
  autoMipmaps: boolean;
  extensionChunks: RenderWareExtensionChunk[];
}

export type RenderWareMaterialEffect =
  | { type: "nothing" }
  | {
      type: "bump-map";
      coefficient: number;
      bumpedTexture?: RenderWareTextureReference;
      texture?: RenderWareTextureReference;
    }
  | {
      type: "environment-map";
      coefficient: number;
      useFrameBufferAlpha: boolean;
      texture?: RenderWareTextureReference;
    }
  | {
      type: "dual";
      sourceBlend: number;
      destinationBlend: number;
      texture?: RenderWareTextureReference;
    }
  | { type: "uv-transform" };

export interface RenderWareMaterialEffects {
  type: number;
  effects: RenderWareMaterialEffect[];
}

export interface RenderWareMaterial {
  flags: number;
  color: [number, number, number, number];
  unused: number;
  surfaceProperties: RenderWareSurfaceProperties;
  texture?: RenderWareTextureReference;
  effects?: RenderWareMaterialEffects;
  extensionChunks: RenderWareExtensionChunk[];
}

function requireLength(chunk: RenderWareChunkHeader, minimum: number, context: string): void {
  if (chunk.length < minimum) {
    throw new RenderWareParseError(`${context} is too small at 0x${chunk.offset.toString(16)}`);
  }
}

export function parseTextureReference(view: BinaryView, chunk: RenderWareChunkHeader): RenderWareTextureReference {
  expectChunk(chunk, RW_CHUNK_IDS.texture, "texture reference");
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "texture");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "texture struct");
  if (struct.length !== 4) {
    throw new RenderWareParseError(`Texture struct has ${struct.length} bytes, expected 4`);
  }
  const filterAddressing = view.u32(struct.dataOffset, "texture filter and addressing flags");
  const addressU = (filterAddressing >>> 8) & 0x0f;
  const storedAddressV = (filterAddressing >>> 12) & 0x0f;
  const filterMode = filterAddressing & 0xff;
  const nameChunk = cursor.expect(RW_CHUNK_IDS.string, "texture name");
  const maskChunk = cursor.expect(RW_CHUNK_IDS.string, "texture mask name");
  const extensionChunks = listExtensionChunks(
    view,
    cursor.expect(RW_CHUNK_IDS.extension, "texture extension"),
    "texture extension",
  );
  if (!cursor.done) {
    throw new RenderWareParseError("Texture contains unexpected trailing chunks");
  }
  return {
    name: view.ascii(nameChunk.dataOffset, nameChunk.length, "texture name"),
    maskName: view.ascii(maskChunk.dataOffset, maskChunk.length, "texture mask name"),
    filterAddressing,
    filterMode,
    addressU,
    addressV: storedAddressV === 0 ? addressU : storedAddressV,
    usesMipmaps: filterMode >= RW_TEXTURE_FILTER_MODES.mipNearest && filterMode <= RW_TEXTURE_FILTER_MODES.linearMipLinear,
    autoMipmaps: (filterAddressing & 0x1_0000) === 0,
    extensionChunks,
  };
}

function parseMaterialEffects(view: BinaryView, chunk: RenderWareChunkHeader): RenderWareMaterialEffects {
  let offset = chunk.dataOffset;
  const readU32 = (context: string): number => {
    const value = view.u32(offset, context);
    offset += 4;
    return value;
  };
  const readF32 = (context: string): number => {
    const value = view.f32(offset, context);
    offset += 4;
    return value;
  };
  const readOptionalTexture = (context: string): RenderWareTextureReference | undefined => {
    if (readU32(`${context} present flag`) === 0) {
      return undefined;
    }
    const textureChunk = expectChunk(
      readChunkHeader(view, offset, chunk.endOffset),
      RW_CHUNK_IDS.texture,
      context,
    );
    offset = textureChunk.endOffset;
    return parseTextureReference(view, textureChunk);
  };

  const type = readU32("material effects type");
  const effects: RenderWareMaterialEffect[] = [];
  for (let index = 0; index < 2; index += 1) {
    const effectType = readU32(`material effect ${index} type`);
    switch (effectType) {
      case RW_MATERIAL_EFFECT_TYPES.nothing:
        effects.push({ type: "nothing" });
        break;
      case RW_MATERIAL_EFFECT_TYPES.bumpMap: {
        const coefficient = readF32(`material effect ${index} bump coefficient`);
        const bumpedTexture = readOptionalTexture(`material effect ${index} bumped texture`);
        const texture = readOptionalTexture(`material effect ${index} bump texture`);
        effects.push({
          type: "bump-map",
          coefficient,
          ...(bumpedTexture === undefined ? {} : { bumpedTexture }),
          ...(texture === undefined ? {} : { texture }),
        });
        break;
      }
      case RW_MATERIAL_EFFECT_TYPES.environmentMap: {
        const coefficient = readF32(`material effect ${index} environment coefficient`);
        const useFrameBufferAlpha = readU32(`material effect ${index} frame-buffer alpha`) !== 0;
        const texture = readOptionalTexture(`material effect ${index} environment texture`);
        effects.push({
          type: "environment-map",
          coefficient,
          useFrameBufferAlpha,
          ...(texture === undefined ? {} : { texture }),
        });
        break;
      }
      case RW_MATERIAL_EFFECT_TYPES.dual: {
        const sourceBlend = readU32(`material effect ${index} source blend`);
        const destinationBlend = readU32(`material effect ${index} destination blend`);
        const texture = readOptionalTexture(`material effect ${index} dual texture`);
        effects.push({
          type: "dual",
          sourceBlend,
          destinationBlend,
          ...(texture === undefined ? {} : { texture }),
        });
        break;
      }
      case RW_MATERIAL_EFFECT_TYPES.uvTransform:
        effects.push({ type: "uv-transform" });
        break;
      default:
        throw new RenderWareParseError(`Unsupported material effect type ${effectType}`);
    }
  }
  if (offset !== chunk.endOffset) {
    throw new RenderWareParseError(
      `Material effects parsing ended at 0x${offset.toString(16)}, expected 0x${chunk.endOffset.toString(16)}`,
    );
  }
  return { type, effects };
}

function parseMaterialExtension(
  view: BinaryView,
  extension: RenderWareChunkHeader,
): { chunks: RenderWareExtensionChunk[]; effects?: RenderWareMaterialEffects } {
  expectChunk(extension, RW_CHUNK_IDS.extension, "material extension");
  const cursor = new ChunkCursor(view, extension.dataOffset, extension.endOffset, "material extension");
  const chunks: RenderWareExtensionChunk[] = [];
  let effects: RenderWareMaterialEffects | undefined;
  while (!cursor.done) {
    const child = cursor.next();
    chunks.push({ id: child.id, name: child.name, length: child.length, libraryId: child.libraryId });
    if (child.id === RW_CHUNK_IDS.materialEffects) {
      if (effects) {
        throw new RenderWareParseError("Material contains more than one MatFX extension");
      }
      effects = parseMaterialEffects(view, child);
    }
  }
  return { chunks, ...(effects === undefined ? {} : { effects }) };
}

function parseMaterial(view: BinaryView, chunk: RenderWareChunkHeader): RenderWareMaterial {
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "material");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "material struct");
  requireLength(struct, 16, "Material struct");
  if (struct.length !== 16 && struct.length !== 28) {
    throw new RenderWareParseError(`Material struct has unsupported ${struct.length}-byte layout`);
  }
  const textured = view.u32(struct.dataOffset + 12, "material textured flag") !== 0;
  const material: RenderWareMaterial = {
    flags: view.u32(struct.dataOffset, "material flags"),
    color: [
      view.u8(struct.dataOffset + 4),
      view.u8(struct.dataOffset + 5),
      view.u8(struct.dataOffset + 6),
      view.u8(struct.dataOffset + 7),
    ],
    unused: view.u32(struct.dataOffset + 8, "material unused field"),
    surfaceProperties: struct.length === 28
      ? {
          ambient: view.f32(struct.dataOffset + 16, "material ambient coefficient"),
          specular: view.f32(struct.dataOffset + 20, "material specular coefficient"),
          diffuse: view.f32(struct.dataOffset + 24, "material diffuse coefficient"),
        }
      : { ambient: 1, specular: 1, diffuse: 1 },
    extensionChunks: [],
  };
  if (textured) {
    material.texture = parseTextureReference(view, cursor.expect(RW_CHUNK_IDS.texture, "material texture"));
  }
  const extension = parseMaterialExtension(view, cursor.expect(RW_CHUNK_IDS.extension, "material extension"));
  material.extensionChunks = extension.chunks;
  if (extension.effects) {
    material.effects = extension.effects;
  }
  if (!cursor.done) {
    throw new RenderWareParseError("Material contains unexpected trailing chunks");
  }
  return material;
}

export function parseMaterialList(view: BinaryView, chunk: RenderWareChunkHeader): RenderWareMaterial[] {
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "material list");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "material list struct");
  requireLength(struct, 4, "Material list struct");
  const count = view.u32(struct.dataOffset, "material count");
  if (struct.length !== 4 + count * 4) {
    throw new RenderWareParseError(`Material list has an invalid ${struct.length}-byte struct for ${count} materials`);
  }
  const materials: RenderWareMaterial[] = [];
  for (let index = 0; index < count; index += 1) {
    const reference = view.i32(struct.dataOffset + 4 + index * 4, `material ${index} reference`);
    if (reference === -1) {
      materials.push(parseMaterial(view, cursor.expect(RW_CHUNK_IDS.material, `material ${index}`)));
    } else if (reference < 0 || reference >= index) {
      throw new RenderWareParseError(`Material ${index} has invalid reference ${reference}`);
    } else {
      materials.push(materials[reference]!);
    }
  }
  if (!cursor.done) {
    throw new RenderWareParseError("Material list contains unexpected trailing chunks");
  }
  return materials;
}
