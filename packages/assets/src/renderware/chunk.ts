const CHUNK_HEADER_SIZE = 12;

export const RW_CHUNK_IDS = {
  struct: 0x01,
  string: 0x02,
  extension: 0x03,
  texture: 0x06,
  material: 0x07,
  materialList: 0x08,
  atomicSector: 0x09,
  planeSector: 0x0a,
  world: 0x0b,
  frameList: 0x0e,
  geometry: 0x0f,
  clump: 0x10,
  atomic: 0x14,
  textureNative: 0x15,
  textureDictionary: 0x16,
  image: 0x18,
  geometryList: 0x1a,
  piTextureDictionary: 0x23,
  materialEffects: 0x120,
} as const;

const CHUNK_NAMES = new Map<number, string>(
  Object.entries(RW_CHUNK_IDS).map(([name, id]) => [id, name]),
);

export class RenderWareParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RenderWareParseError";
  }
}

export interface RenderWareChunkHeader {
  id: number;
  name: string;
  offset: number;
  dataOffset: number;
  length: number;
  endOffset: number;
  libraryId: number;
}

export interface RenderWareExtensionChunk {
  id: number;
  name: string;
  length: number;
  libraryId: number;
}

function hex(value: number): string {
  return `0x${value.toString(16)}`;
}

export class BinaryView {
  public readonly bytes: Uint8Array;
  private readonly view: DataView;

  public constructor(input: ArrayBuffer | Uint8Array) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  public get length(): number {
    return this.bytes.byteLength;
  }

  public assertRange(offset: number, length: number, context: string): void {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > this.length) {
      throw new RenderWareParseError(
        `${context} exceeds the stream at ${hex(offset)} (length ${length}, stream ${this.length})`,
      );
    }
  }

  public u8(offset: number, context = "uint8"): number {
    this.assertRange(offset, 1, context);
    return this.view.getUint8(offset);
  }

  public i8(offset: number, context = "int8"): number {
    this.assertRange(offset, 1, context);
    return this.view.getInt8(offset);
  }

  public u16(offset: number, context = "uint16"): number {
    this.assertRange(offset, 2, context);
    return this.view.getUint16(offset, true);
  }

  public u32(offset: number, context = "uint32"): number {
    this.assertRange(offset, 4, context);
    return this.view.getUint32(offset, true);
  }

  public i32(offset: number, context = "int32"): number {
    this.assertRange(offset, 4, context);
    return this.view.getInt32(offset, true);
  }

  public f32(offset: number, context = "float32"): number {
    this.assertRange(offset, 4, context);
    return this.view.getFloat32(offset, true);
  }

  public slice(offset: number, length: number, context = "byte range"): Uint8Array {
    this.assertRange(offset, length, context);
    return this.bytes.slice(offset, offset + length);
  }

  public ascii(offset: number, length: number, context = "string"): string {
    const bytes = this.slice(offset, length, context);
    const terminator = bytes.indexOf(0);
    return new TextDecoder("windows-1252").decode(terminator === -1 ? bytes : bytes.subarray(0, terminator));
  }
}

export function readChunkHeader(view: BinaryView, offset: number, limit = view.length): RenderWareChunkHeader {
  if (limit < 0 || limit > view.length) {
    throw new RenderWareParseError(`Invalid chunk boundary ${hex(limit)}`);
  }
  if (offset < 0 || offset + CHUNK_HEADER_SIZE > limit) {
    throw new RenderWareParseError(`Truncated RenderWare chunk header at ${hex(offset)}`);
  }
  const id = view.u32(offset, "chunk id");
  const length = view.u32(offset + 4, "chunk length");
  const libraryId = view.u32(offset + 8, "chunk library id");
  const dataOffset = offset + CHUNK_HEADER_SIZE;
  const endOffset = dataOffset + length;
  if (endOffset > limit || endOffset < dataOffset) {
    throw new RenderWareParseError(
      `RenderWare chunk ${CHUNK_NAMES.get(id) ?? hex(id)} at ${hex(offset)} ends beyond ${hex(limit)}`,
    );
  }
  return {
    id,
    name: CHUNK_NAMES.get(id) ?? `unknown-${hex(id)}`,
    offset,
    dataOffset,
    length,
    endOffset,
    libraryId,
  };
}

export function expectChunk(
  chunk: RenderWareChunkHeader,
  expectedId: number,
  context: string,
): RenderWareChunkHeader {
  if (chunk.id !== expectedId) {
    throw new RenderWareParseError(
      `${context} expected ${CHUNK_NAMES.get(expectedId) ?? hex(expectedId)} at ${hex(chunk.offset)}, got ${chunk.name}`,
    );
  }
  return chunk;
}

export function listExtensionChunks(
  view: BinaryView,
  extension: RenderWareChunkHeader,
  context: string,
): RenderWareExtensionChunk[] {
  expectChunk(extension, RW_CHUNK_IDS.extension, context);
  const cursor = new ChunkCursor(view, extension.dataOffset, extension.endOffset, context);
  const chunks: RenderWareExtensionChunk[] = [];
  while (!cursor.done) {
    const child = cursor.next();
    chunks.push({
      id: child.id,
      name: child.name,
      length: child.length,
      libraryId: child.libraryId,
    });
  }
  return chunks;
}

export class ChunkCursor {
  private offset: number;

  public constructor(
    private readonly view: BinaryView,
    start: number,
    private readonly end: number,
    private readonly context: string,
  ) {
    this.offset = start;
    view.assertRange(start, end - start, context);
  }

  public get done(): boolean {
    return this.offset === this.end;
  }

  public next(): RenderWareChunkHeader {
    if (this.offset >= this.end) {
      throw new RenderWareParseError(`${this.context} has no more chunks at ${hex(this.offset)}`);
    }
    const chunk = readChunkHeader(this.view, this.offset, this.end);
    this.offset = chunk.endOffset;
    return chunk;
  }

  public expect(id: number, childContext: string): RenderWareChunkHeader {
    return expectChunk(this.next(), id, childContext);
  }
}
