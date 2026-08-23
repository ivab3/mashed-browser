import {
  BinaryView,
  ChunkCursor,
  expectChunk,
  readChunkHeader,
  RenderWareParseError,
  RW_CHUNK_IDS,
  type RenderWareChunkHeader,
} from "./chunk.js";
import { parseMaterialList, type RenderWareMaterial } from "./material.js";
import { RW_GEOMETRY_FLAGS, textureCoordinateSetCount } from "./conventions.js";

const WORLD_SECTOR_HEADER_SIZE = 44;

export interface BspWorldHeader {
  libraryId: number;
  rootIsWorldSector: boolean;
  inverseWorldOrigin: [number, number, number];
  triangleCount: number;
  vertexCount: number;
  planeSectorCount: number;
  worldSectorCount: number;
  collisionSectorSize: number;
  format: number;
  boundingBoxMaximum: [number, number, number];
  boundingBoxMinimum: [number, number, number];
}

export interface BspPlaneSector {
  kind: "plane";
  axis: 0 | 1 | 2;
  splitValue: number;
  leftValue: number;
  rightValue: number;
  left: BspSector;
  right: BspSector;
}

export interface BspWorldSector {
  kind: "world";
  index: number;
  materialWindowBase: number;
  triangleCount: number;
  vertexCount: number;
  boundingBoxMaximum: [number, number, number];
  boundingBoxMinimum: [number, number, number];
  storedFormat: number;
  positions: Float32Array;
  normals?: Float32Array;
  colors?: Uint8Array;
  uvSets: Float32Array[];
  indices: Uint32Array;
  triangleMaterialIndices: Uint16Array;
}

export type BspSector = BspPlaneSector | BspWorldSector;

export interface BspWorld {
  header: BspWorldHeader;
  materials: RenderWareMaterial[];
  rootSector: BspSector;
  worldSectors: BspWorldSector[];
}

function vector(view: BinaryView, offset: number): [number, number, number] {
  return [view.f32(offset), view.f32(offset + 4), view.f32(offset + 8)];
}

function parseHeader(
  view: BinaryView,
  root: RenderWareChunkHeader,
  struct: RenderWareChunkHeader,
): BspWorldHeader {
  if (struct.length !== 64) {
    throw new RenderWareParseError(`World struct has ${struct.length} bytes, expected 64`);
  }
  const rootIsWorldSector = view.u32(struct.dataOffset, "world root sector flag");
  if (rootIsWorldSector !== 0 && rootIsWorldSector !== 1) {
    throw new RenderWareParseError(`World has invalid root sector flag ${rootIsWorldSector}`);
  }
  return {
    libraryId: root.libraryId,
    rootIsWorldSector: rootIsWorldSector === 1,
    inverseWorldOrigin: vector(view, struct.dataOffset + 4),
    triangleCount: view.u32(struct.dataOffset + 16, "world triangle count"),
    vertexCount: view.u32(struct.dataOffset + 20, "world vertex count"),
    planeSectorCount: view.u32(struct.dataOffset + 24, "world plane sector count"),
    worldSectorCount: view.u32(struct.dataOffset + 28, "world sector count"),
    collisionSectorSize: view.u32(struct.dataOffset + 32, "world collision sector size"),
    format: view.u32(struct.dataOffset + 36, "world format"),
    boundingBoxMaximum: vector(view, struct.dataOffset + 40),
    boundingBoxMinimum: vector(view, struct.dataOffset + 52),
  };
}

function parseWorldSectorStruct(
  view: BinaryView,
  chunk: RenderWareChunkHeader,
  worldFormat: number,
  materialCount: number,
  index: number,
): BspWorldSector {
  if (chunk.length < WORLD_SECTOR_HEADER_SIZE) {
    throw new RenderWareParseError(`World sector ${index} struct is too small`);
  }
  const materialWindowBase = view.u32(chunk.dataOffset, `world sector ${index} material window`);
  const triangleCount = view.u32(chunk.dataOffset + 4, `world sector ${index} triangle count`);
  const vertexCount = view.u32(chunk.dataOffset + 8, `world sector ${index} vertex count`);
  if (triangleCount > 10_000_000 || vertexCount > 10_000_000) {
    throw new RenderWareParseError(`World sector ${index} declares unreasonable element counts`);
  }
  const sector: BspWorldSector = {
    kind: "world",
    index,
    materialWindowBase,
    triangleCount,
    vertexCount,
    boundingBoxMaximum: vector(view, chunk.dataOffset + 12),
    boundingBoxMinimum: vector(view, chunk.dataOffset + 24),
    storedFormat: view.u32(chunk.dataOffset + 36, `world sector ${index} stored format`),
    positions: new Float32Array(vertexCount * 3),
    uvSets: [],
    indices: new Uint32Array(triangleCount * 3),
    triangleMaterialIndices: new Uint16Array(triangleCount),
  };

  let offset = chunk.dataOffset + WORLD_SECTOR_HEADER_SIZE;
  for (let positionIndex = 0; positionIndex < sector.positions.length; positionIndex += 1) {
    sector.positions[positionIndex] = view.f32(offset, `world sector ${index} position`);
    offset += 4;
  }

  if ((worldFormat & RW_GEOMETRY_FLAGS.normals) !== 0) {
    const normals = new Float32Array(vertexCount * 3);
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      for (let component = 0; component < 3; component += 1) {
        normals[vertexIndex * 3 + component] = Math.max(
          -1,
          view.i8(offset + component, `world sector ${index} normal`) / 127,
        );
      }
      offset += 4;
    }
    sector.normals = normals;
  }

  if ((worldFormat & RW_GEOMETRY_FLAGS.prelit) !== 0) {
    sector.colors = view.slice(offset, vertexCount * 4, `world sector ${index} prelit colors`);
    offset += vertexCount * 4;
  }

  for (let setIndex = 0; setIndex < textureCoordinateSetCount(worldFormat); setIndex += 1) {
    const uv = new Float32Array(vertexCount * 2);
    for (let uvIndex = 0; uvIndex < uv.length; uvIndex += 1) {
      uv[uvIndex] = view.f32(offset, `world sector ${index} UV set ${setIndex}`);
      offset += 4;
    }
    sector.uvSets.push(uv);
  }

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const vertex1 = view.u16(offset, `world sector ${index} triangle ${triangleIndex} vertex 1`);
    const vertex2 = view.u16(offset + 2, `world sector ${index} triangle ${triangleIndex} vertex 2`);
    const vertex3 = view.u16(offset + 4, `world sector ${index} triangle ${triangleIndex} vertex 3`);
    const localMaterialIndex = view.u16(offset + 6, `world sector ${index} triangle ${triangleIndex} material`);
    if (vertex1 >= vertexCount || vertex2 >= vertexCount || vertex3 >= vertexCount) {
      throw new RenderWareParseError(`World sector ${index} triangle ${triangleIndex} references a missing vertex`);
    }
    const materialIndex = materialWindowBase + localMaterialIndex;
    if (materialIndex >= materialCount) {
      throw new RenderWareParseError(`World sector ${index} triangle ${triangleIndex} references missing material ${materialIndex}`);
    }
    sector.indices.set([vertex1, vertex2, vertex3], triangleIndex * 3);
    sector.triangleMaterialIndices[triangleIndex] = materialIndex;
    offset += 8;
  }

  if (offset !== chunk.endOffset) {
    throw new RenderWareParseError(
      `World sector ${index} parsing ended at 0x${offset.toString(16)}, expected 0x${chunk.endOffset.toString(16)}`,
    );
  }
  return sector;
}

interface SectorParseContext {
  worldFormat: number;
  materialCount: number;
  worldSectors: BspWorldSector[];
  planeSectorCount: number;
}

function parseSector(
  view: BinaryView,
  chunk: RenderWareChunkHeader,
  context: SectorParseContext,
  depth = 0,
): BspSector {
  if (depth > 1024) {
    throw new RenderWareParseError("BSP sector tree is deeper than 1024 levels");
  }
  if (chunk.id === RW_CHUNK_IDS.atomicSector) {
    const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "world sector");
    const struct = cursor.expect(RW_CHUNK_IDS.struct, "world sector struct");
    const sector = parseWorldSectorStruct(
      view,
      struct,
      context.worldFormat,
      context.materialCount,
      context.worldSectors.length,
    );
    cursor.expect(RW_CHUNK_IDS.extension, `world sector ${sector.index} extension`);
    if (!cursor.done) {
      throw new RenderWareParseError(`World sector ${sector.index} contains unexpected trailing chunks`);
    }
    context.worldSectors.push(sector);
    return sector;
  }
  expectChunk(chunk, RW_CHUNK_IDS.planeSector, "BSP sector");
  context.planeSectorCount += 1;
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "plane sector");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "plane sector struct");
  if (struct.length !== 24) {
    throw new RenderWareParseError(`Plane sector struct has ${struct.length} bytes, expected 24`);
  }
  const splitType = view.u32(struct.dataOffset, "plane sector split type");
  const axis = splitType >>> 2;
  if ((splitType & 3) !== 0 || axis > 2) {
    throw new RenderWareParseError(`Plane sector has unsupported split type ${splitType}`);
  }
  const leftIsWorldSector = view.u32(struct.dataOffset + 8, "left sector type");
  const rightIsWorldSector = view.u32(struct.dataOffset + 12, "right sector type");
  if (leftIsWorldSector > 1 || rightIsWorldSector > 1) {
    throw new RenderWareParseError("Plane sector has invalid child type flags");
  }
  const leftChunk = cursor.next();
  expectChunk(leftChunk, leftIsWorldSector === 1 ? RW_CHUNK_IDS.atomicSector : RW_CHUNK_IDS.planeSector, "left sector");
  const left = parseSector(view, leftChunk, context, depth + 1);
  const rightChunk = cursor.next();
  expectChunk(rightChunk, rightIsWorldSector === 1 ? RW_CHUNK_IDS.atomicSector : RW_CHUNK_IDS.planeSector, "right sector");
  const right = parseSector(view, rightChunk, context, depth + 1);
  if (!cursor.done) {
    throw new RenderWareParseError("Plane sector contains unexpected trailing chunks");
  }
  return {
    kind: "plane",
    axis: axis as 0 | 1 | 2,
    splitValue: view.f32(struct.dataOffset + 4, "plane sector split value"),
    leftValue: view.f32(struct.dataOffset + 16, "plane sector left value"),
    rightValue: view.f32(struct.dataOffset + 20, "plane sector right value"),
    left,
    right,
  };
}

function openWorld(input: ArrayBuffer | Uint8Array): {
  view: BinaryView;
  root: RenderWareChunkHeader;
  cursor: ChunkCursor;
  header: BspWorldHeader;
} {
  const view = new BinaryView(input);
  const root = expectChunk(readChunkHeader(view, 0), RW_CHUNK_IDS.world, "BSP root");
  if (root.endOffset !== view.length) {
    throw new RenderWareParseError(`BSP contains ${view.length - root.endOffset} trailing bytes after its world`);
  }
  const cursor = new ChunkCursor(view, root.dataOffset, root.endOffset, "world");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "world struct");
  return { view, root, cursor, header: parseHeader(view, root, struct) };
}

export function parseBspWorldHeader(input: ArrayBuffer | Uint8Array): BspWorldHeader {
  return openWorld(input).header;
}

export function parseBspWorld(input: ArrayBuffer | Uint8Array): BspWorld {
  const { view, cursor, header } = openWorld(input);
  const materials = parseMaterialList(view, cursor.expect(RW_CHUNK_IDS.materialList, "world material list"));
  const context: SectorParseContext = {
    worldFormat: header.format,
    materialCount: materials.length,
    worldSectors: [],
    planeSectorCount: 0,
  };
  const rootChunk = cursor.next();
  expectChunk(
    rootChunk,
    header.rootIsWorldSector ? RW_CHUNK_IDS.atomicSector : RW_CHUNK_IDS.planeSector,
    "world root sector",
  );
  const rootSector = parseSector(view, rootChunk, context);
  cursor.expect(RW_CHUNK_IDS.extension, "world extension");
  if (!cursor.done) {
    throw new RenderWareParseError("World contains unexpected trailing chunks");
  }

  const vertexCount = context.worldSectors.reduce((sum, sector) => sum + sector.vertexCount, 0);
  const triangleCount = context.worldSectors.reduce((sum, sector) => sum + sector.triangleCount, 0);
  if (context.worldSectors.length !== header.worldSectorCount || context.planeSectorCount !== header.planeSectorCount) {
    throw new RenderWareParseError(
      `BSP sector counts differ from header: ${context.planeSectorCount}/${header.planeSectorCount} plane, ${context.worldSectors.length}/${header.worldSectorCount} world`,
    );
  }
  if (vertexCount !== header.vertexCount || triangleCount !== header.triangleCount) {
    throw new RenderWareParseError(
      `BSP geometry counts differ from header: ${vertexCount}/${header.vertexCount} vertices, ${triangleCount}/${header.triangleCount} triangles`,
    );
  }
  return { header, materials, rootSector, worldSectors: context.worldSectors };
}
