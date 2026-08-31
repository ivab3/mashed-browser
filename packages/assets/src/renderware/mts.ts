import { BinaryView, expectChunk, readChunkHeader, RenderWareParseError, RW_CHUNK_IDS } from "./chunk.js";

export interface MtsMatrix {
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  at: readonly [number, number, number];
  position: readonly [number, number, number];
  flags: number;
  libraryId: number;
}

export interface MtsInstances {
  matrices: readonly MtsMatrix[];
}

/** Count-prefixed RenderWare matrix streams; flags are preserved, not interpreted. */
export function parseMts(input: ArrayBuffer | Uint8Array): MtsInstances {
  const view = new BinaryView(input);
  const count = view.u32(0, "MTS matrix count");
  if (count > 100_000 || view.length !== 4 + count * 76) {
    throw new RenderWareParseError(`MTS declares ${count} matrices but has ${view.length} bytes`);
  }
  const vector = (offset: number): [number, number, number] => {
    const values: [number, number, number] = [view.f32(offset), view.f32(offset + 4), view.f32(offset + 8)];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new RenderWareParseError("MTS matrix coordinates must be finite");
    }
    return values;
  };
  const matrices: MtsMatrix[] = [];
  for (let index = 0; index < count; index += 1) {
    const matrix = expectChunk(readChunkHeader(view, 4 + index * 76), RW_CHUNK_IDS.matrix, "MTS matrix");
    const struct = expectChunk(readChunkHeader(view, matrix.dataOffset, matrix.endOffset), RW_CHUNK_IDS.struct, "MTS matrix struct");
    if (matrix.length !== 64 || struct.length !== 52 || struct.libraryId !== matrix.libraryId) {
      throw new RenderWareParseError(`MTS matrix ${index} has an unsupported layout`);
    }
    const offset = struct.dataOffset;
    matrices.push({
      right: vector(offset), up: vector(offset + 12), at: vector(offset + 24),
      position: vector(offset + 36), flags: view.u32(offset + 48), libraryId: matrix.libraryId,
    });
  }
  return { matrices };
}
