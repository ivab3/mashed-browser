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

export interface DffFrame {
  right: [number, number, number];
  up: [number, number, number];
  at: [number, number, number];
  position: [number, number, number];
  parentIndex: number;
  flags: number;
}

export interface DffMorphTarget {
  boundingSphere: [number, number, number, number];
  positions?: Float32Array;
  normals?: Float32Array;
}

export type DffMaterial = RenderWareMaterial;

export interface DffGeometry {
  format: number;
  vertexCount: number;
  triangleCount: number;
  colors?: Uint8Array;
  uvSets: Float32Array[];
  indices: Uint32Array;
  triangleMaterialIndices: Uint16Array;
  morphTargets: DffMorphTarget[];
  materials: DffMaterial[];
}

export interface DffAtomic {
  frameIndex: number;
  geometryIndex: number;
  flags: number;
}

export interface DffModel {
  libraryId: number;
  frames: DffFrame[];
  geometries: DffGeometry[];
  atomics: DffAtomic[];
}

function readVector(view: BinaryView, offset: number): [number, number, number] {
  return [view.f32(offset), view.f32(offset + 4), view.f32(offset + 8)];
}

function requireLength(chunk: RenderWareChunkHeader, minimum: number, context: string): void {
  if (chunk.length < minimum) {
    throw new RenderWareParseError(`${context} is too small at 0x${chunk.offset.toString(16)}`);
  }
}

function parseFrames(view: BinaryView, chunk: RenderWareChunkHeader): DffFrame[] {
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "frame list");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "frame list struct");
  requireLength(struct, 4, "Frame list struct");
  const count = view.u32(struct.dataOffset, "frame count");
  const expectedLength = 4 + count * 56;
  if (struct.length !== expectedLength) {
    throw new RenderWareParseError(
      `Frame list declares ${count} frames but its struct has ${struct.length} bytes (expected ${expectedLength})`,
    );
  }
  const frames: DffFrame[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = struct.dataOffset + 4 + index * 56;
    const parentIndex = view.i32(offset + 48, `frame ${index} parent`);
    if (parentIndex < -1 || parentIndex >= count || parentIndex === index) {
      throw new RenderWareParseError(`Frame ${index} has invalid parent index ${parentIndex}`);
    }
    frames.push({
      right: readVector(view, offset),
      up: readVector(view, offset + 12),
      at: readVector(view, offset + 24),
      position: readVector(view, offset + 36),
      parentIndex,
      flags: view.u32(offset + 52, `frame ${index} flags`),
    });
  }
  for (let index = 0; index < count; index += 1) {
    cursor.expect(RW_CHUNK_IDS.extension, `frame ${index} extension`);
  }
  if (!cursor.done) {
    throw new RenderWareParseError("Frame list contains unexpected trailing chunks");
  }
  return frames;
}

function parseGeometryStruct(view: BinaryView, chunk: RenderWareChunkHeader): Omit<DffGeometry, "materials"> {
  requireLength(chunk, 16, "Geometry struct");
  const format = view.u32(chunk.dataOffset, "geometry format");
  const triangleCount = view.u32(chunk.dataOffset + 4, "triangle count");
  const vertexCount = view.u32(chunk.dataOffset + 8, "vertex count");
  const morphTargetCount = view.u32(chunk.dataOffset + 12, "morph target count");
  if (vertexCount > 10_000_000 || triangleCount > 10_000_000 || morphTargetCount > 1024) {
    throw new RenderWareParseError("Geometry declares unreasonable element counts");
  }

  let offset = chunk.dataOffset + 16;
  let colors: Uint8Array | undefined;
  if ((format & RW_GEOMETRY_FLAGS.prelit) !== 0) {
    colors = view.slice(offset, vertexCount * 4, "prelit vertex colors");
    offset += vertexCount * 4;
  }

  const uvSets: Float32Array[] = [];
  for (let setIndex = 0; setIndex < textureCoordinateSetCount(format); setIndex += 1) {
    const uv = new Float32Array(vertexCount * 2);
    for (let index = 0; index < uv.length; index += 1) {
      uv[index] = view.f32(offset, `UV set ${setIndex}`);
      offset += 4;
    }
    uvSets.push(uv);
  }

  const indices = new Uint32Array(triangleCount * 3);
  const triangleMaterialIndices = new Uint16Array(triangleCount);
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const vertex2 = view.u16(offset, `triangle ${triangleIndex} vertex 2`);
    const vertex1 = view.u16(offset + 2, `triangle ${triangleIndex} vertex 1`);
    const material = view.u16(offset + 4, `triangle ${triangleIndex} material`);
    const vertex3 = view.u16(offset + 6, `triangle ${triangleIndex} vertex 3`);
    if (vertex1 >= vertexCount || vertex2 >= vertexCount || vertex3 >= vertexCount) {
      throw new RenderWareParseError(`Triangle ${triangleIndex} references a vertex outside geometry`);
    }
    indices.set([vertex1, vertex2, vertex3], triangleIndex * 3);
    triangleMaterialIndices[triangleIndex] = material;
    offset += 8;
  }

  const morphTargets: DffMorphTarget[] = [];
  for (let morphIndex = 0; morphIndex < morphTargetCount; morphIndex += 1) {
    const boundingSphere: [number, number, number, number] = [
      view.f32(offset),
      view.f32(offset + 4),
      view.f32(offset + 8),
      view.f32(offset + 12),
    ];
    const hasPositions = view.u32(offset + 16, `morph target ${morphIndex} position flag`) !== 0;
    const hasNormals = view.u32(offset + 20, `morph target ${morphIndex} normal flag`) !== 0;
    offset += 24;
    const target: DffMorphTarget = { boundingSphere };
    if (hasPositions) {
      const positions = new Float32Array(vertexCount * 3);
      for (let index = 0; index < positions.length; index += 1) {
        positions[index] = view.f32(offset, `morph target ${morphIndex} position`);
        offset += 4;
      }
      target.positions = positions;
    }
    if (hasNormals) {
      const normals = new Float32Array(vertexCount * 3);
      for (let index = 0; index < normals.length; index += 1) {
        normals[index] = view.f32(offset, `morph target ${morphIndex} normal`);
        offset += 4;
      }
      target.normals = normals;
    }
    morphTargets.push(target);
  }
  if (offset !== chunk.endOffset) {
    throw new RenderWareParseError(
      `Geometry struct parsing ended at 0x${offset.toString(16)}, expected 0x${chunk.endOffset.toString(16)}`,
    );
  }
  return {
    format,
    vertexCount,
    triangleCount,
    ...(colors === undefined ? {} : { colors }),
    uvSets,
    indices,
    triangleMaterialIndices,
    morphTargets,
  };
}

function parseGeometry(view: BinaryView, chunk: RenderWareChunkHeader): DffGeometry {
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "geometry");
  const geometry = parseGeometryStruct(view, cursor.expect(RW_CHUNK_IDS.struct, "geometry struct"));
  const materials = parseMaterialList(view, cursor.expect(RW_CHUNK_IDS.materialList, "geometry material list"));
  cursor.expect(RW_CHUNK_IDS.extension, "geometry extension");
  if (!cursor.done) {
    throw new RenderWareParseError("Geometry contains unexpected trailing chunks");
  }
  for (let triangleIndex = 0; triangleIndex < geometry.triangleMaterialIndices.length; triangleIndex += 1) {
    const materialIndex = geometry.triangleMaterialIndices[triangleIndex]!;
    if (materialIndex >= materials.length) {
      throw new RenderWareParseError(`Triangle ${triangleIndex} references missing material ${materialIndex}`);
    }
  }
  return { ...geometry, materials };
}

function parseGeometries(view: BinaryView, chunk: RenderWareChunkHeader): DffGeometry[] {
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "geometry list");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "geometry list struct");
  requireLength(struct, 4, "Geometry list struct");
  const count = view.u32(struct.dataOffset, "geometry count");
  const geometries: DffGeometry[] = [];
  for (let index = 0; index < count; index += 1) {
    geometries.push(parseGeometry(view, cursor.expect(RW_CHUNK_IDS.geometry, `geometry ${index}`)));
  }
  if (!cursor.done) {
    throw new RenderWareParseError("Geometry list contains unexpected trailing chunks");
  }
  return geometries;
}

function parseAtomic(view: BinaryView, chunk: RenderWareChunkHeader): DffAtomic {
  const cursor = new ChunkCursor(view, chunk.dataOffset, chunk.endOffset, "atomic");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "atomic struct");
  requireLength(struct, 16, "Atomic struct");
  const atomic = {
    frameIndex: view.i32(struct.dataOffset, "atomic frame index"),
    geometryIndex: view.i32(struct.dataOffset + 4, "atomic geometry index"),
    flags: view.u32(struct.dataOffset + 8, "atomic flags"),
  };
  cursor.expect(RW_CHUNK_IDS.extension, "atomic extension");
  if (!cursor.done) {
    throw new RenderWareParseError("Atomic contains unexpected trailing chunks");
  }
  return atomic;
}

export function parseDff(input: ArrayBuffer | Uint8Array): DffModel {
  const view = new BinaryView(input);
  const root = expectChunk(readChunkHeader(view, 0), RW_CHUNK_IDS.clump, "DFF root");
  if (root.endOffset !== view.length) {
    throw new RenderWareParseError(`DFF contains ${view.length - root.endOffset} trailing bytes after its clump`);
  }
  const cursor = new ChunkCursor(view, root.dataOffset, root.endOffset, "clump");
  const struct = cursor.expect(RW_CHUNK_IDS.struct, "clump struct");
  requireLength(struct, 4, "Clump struct");
  const atomicCount = view.u32(struct.dataOffset, "atomic count");
  const frames = parseFrames(view, cursor.expect(RW_CHUNK_IDS.frameList, "clump frame list"));
  const geometries = parseGeometries(view, cursor.expect(RW_CHUNK_IDS.geometryList, "clump geometry list"));
  const atomics: DffAtomic[] = [];
  for (let index = 0; index < atomicCount; index += 1) {
    const atomic = parseAtomic(view, cursor.expect(RW_CHUNK_IDS.atomic, `atomic ${index}`));
    if (atomic.frameIndex < 0 || atomic.frameIndex >= frames.length) {
      throw new RenderWareParseError(`Atomic ${index} references missing frame ${atomic.frameIndex}`);
    }
    if (atomic.geometryIndex < 0 || atomic.geometryIndex >= geometries.length) {
      throw new RenderWareParseError(`Atomic ${index} references missing geometry ${atomic.geometryIndex}`);
    }
    atomics.push(atomic);
  }
  while (!cursor.done) {
    cursor.next();
  }
  return { libraryId: root.libraryId, frames, geometries, atomics };
}
