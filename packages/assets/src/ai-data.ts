import {
  BinaryView,
  RenderWareParseError,
  expectChunk,
  readChunkHeader,
} from "./renderware/chunk.js";

export const AI_DATA_CHUNK_ID = 0x1326_9902;
export const LED_DATA_CHUNK_ID = 0x1326_9901;
export const AI_GRID_WIDTH = 256;
export const AI_GRID_HEIGHT = 256;
export const AI_TABLE_CAPACITY = 384;

const AI_GRID_BYTES = AI_GRID_WIDTH * AI_GRID_HEIGHT;
const AI_VEC2_TABLE_BYTES = AI_TABLE_CAPACITY * 2 * Float32Array.BYTES_PER_ELEMENT;
const AI_TRAILER_BYTES = 128;
const AI_PAYLOAD_BYTES = AI_GRID_BYTES
  + Uint32Array.BYTES_PER_ELEMENT
  + AI_VEC2_TABLE_BYTES * 2
  + AI_TRAILER_BYTES;
const LED_PAYLOAD_BYTES = AI_TABLE_CAPACITY * 3 * Float32Array.BYTES_PER_ELEMENT;

export type AiDataVector2 = readonly [number, number];
export type LedDataVector3 = readonly [number, number, number];

/**
 * Structurally decoded original `.AI` payload. Field semantics beyond the byte grid and table shapes
 * are intentionally left neutral until they can be confirmed against runtime behavior.
 */
export interface AiDataFile {
  libraryId: number;
  grid: {
    width: typeof AI_GRID_WIDTH;
    height: typeof AI_GRID_HEIGHT;
    cells: Uint8Array;
  };
  declaredEntryCount: number;
  tableA: readonly AiDataVector2[];
  tableB: readonly AiDataVector2[];
  trailer: Uint8Array;
}

/** Structurally decoded original `.LED` payload containing 384 fixed-size float triplets. */
export interface LedDataFile {
  libraryId: number;
  entries: readonly LedDataVector3[];
}

function assertStandaloneChunk(view: BinaryView, expectedBytes: number, context: string): void {
  if (view.length !== expectedBytes + 12) {
    throw new RenderWareParseError(
      `${context} expected ${expectedBytes + 12} bytes, got ${view.length}`,
    );
  }
}

function finiteFloat(view: BinaryView, offset: number, context: string): number {
  const value = view.f32(offset, context);
  if (!Number.isFinite(value)) {
    throw new RenderWareParseError(`${context} is not finite`);
  }
  return value;
}

function readVectorTable(
  view: BinaryView,
  offset: number,
  dimensions: 2,
  context: string,
): readonly AiDataVector2[];
function readVectorTable(
  view: BinaryView,
  offset: number,
  dimensions: 3,
  context: string,
): readonly LedDataVector3[];
function readVectorTable(
  view: BinaryView,
  offset: number,
  dimensions: 2 | 3,
  context: string,
): readonly (AiDataVector2 | LedDataVector3)[] {
  const entries: Array<AiDataVector2 | LedDataVector3> = [];
  for (let entry = 0; entry < AI_TABLE_CAPACITY; entry += 1) {
    const entryOffset = offset + entry * dimensions * Float32Array.BYTES_PER_ELEMENT;
    const first = finiteFloat(view, entryOffset, `${context}[${entry}].x`);
    const second = finiteFloat(view, entryOffset + 4, `${context}[${entry}].y`);
    entries.push(dimensions === 2
      ? [first, second]
      : [first, second, finiteFloat(view, entryOffset + 8, `${context}[${entry}].z`)]);
  }
  return entries;
}

export function parseAiData(input: ArrayBuffer | Uint8Array): AiDataFile {
  const view = new BinaryView(input);
  assertStandaloneChunk(view, AI_PAYLOAD_BYTES, "AI data");
  const chunk = expectChunk(readChunkHeader(view, 0), AI_DATA_CHUNK_ID, "AI data");
  if (chunk.length !== AI_PAYLOAD_BYTES || chunk.endOffset !== view.length) {
    throw new RenderWareParseError(
      `AI data payload expected ${AI_PAYLOAD_BYTES} bytes, got ${chunk.length}`,
    );
  }

  const gridOffset = chunk.dataOffset;
  const countOffset = gridOffset + AI_GRID_BYTES;
  const tableAOffset = countOffset + Uint32Array.BYTES_PER_ELEMENT;
  const tableBOffset = tableAOffset + AI_VEC2_TABLE_BYTES;
  const trailerOffset = tableBOffset + AI_VEC2_TABLE_BYTES;
  return {
    libraryId: chunk.libraryId,
    grid: {
      width: AI_GRID_WIDTH,
      height: AI_GRID_HEIGHT,
      cells: view.slice(gridOffset, AI_GRID_BYTES, "AI grid"),
    },
    declaredEntryCount: view.u32(countOffset, "AI declared entry count"),
    tableA: readVectorTable(view, tableAOffset, 2, "AI table A"),
    tableB: readVectorTable(view, tableBOffset, 2, "AI table B"),
    trailer: view.slice(trailerOffset, AI_TRAILER_BYTES, "AI trailer"),
  };
}

export function parseLedData(input: ArrayBuffer | Uint8Array): LedDataFile {
  const view = new BinaryView(input);
  assertStandaloneChunk(view, LED_PAYLOAD_BYTES, "LED data");
  const chunk = expectChunk(readChunkHeader(view, 0), LED_DATA_CHUNK_ID, "LED data");
  if (chunk.length !== LED_PAYLOAD_BYTES || chunk.endOffset !== view.length) {
    throw new RenderWareParseError(
      `LED data payload expected ${LED_PAYLOAD_BYTES} bytes, got ${chunk.length}`,
    );
  }
  return {
    libraryId: chunk.libraryId,
    entries: readVectorTable(view, chunk.dataOffset, 3, "LED entries"),
  };
}
