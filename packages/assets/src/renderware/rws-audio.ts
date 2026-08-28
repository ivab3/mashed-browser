import {
  BinaryView,
  ChunkCursor,
  expectChunk,
  readChunkHeader,
  RenderWareParseError,
  RW_CHUNK_IDS,
} from "./chunk.js";

export const RWA_PCM_CODEC_ID = 0xd01bd217;

export interface RwsPcm16Sound {
  name: string;
  sampleRate: number;
  channelCount: 1;
  pcm16: Int16Array;
}

export interface RwsSoundDictionary {
  sounds: RwsPcm16Sound[];
}

function decodePcm16(view: BinaryView, offset: number, byteLength: number, context: string): Int16Array {
  if (byteLength % 2 !== 0) {
    throw new RenderWareParseError(`${context} has an odd PCM16 byte length ${byteLength}`);
  }
  const pcm16 = new Int16Array(byteLength / 2);
  const data = new DataView(
    view.bytes.buffer,
    view.bytes.byteOffset + offset,
    byteLength,
  );
  for (let index = 0; index < pcm16.length; index += 1) {
    pcm16[index] = data.getInt16(index * 2, true);
  }
  return pcm16;
}

/** Parses the PCM wave dictionaries shipped by the PC release. Streaming/voice RWS is a separate format. */
export function parseRwsSoundDictionary(input: ArrayBuffer | Uint8Array): RwsSoundDictionary {
  const view = new BinaryView(input);
  const root = expectChunk(readChunkHeader(view, 0), RW_CHUNK_IDS.waveDictionary, "RWS sound dictionary");
  if (root.endOffset !== view.length) {
    throw new RenderWareParseError("RWS sound dictionary has trailing bytes");
  }

  const rootChunks = new ChunkCursor(view, root.dataOffset, root.endOffset, "RWS sound dictionary");
  rootChunks.expect(RW_CHUNK_IDS.waveDictionaryHeader, "RWS dictionary header");
  const dictionaryData = rootChunks.expect(RW_CHUNK_IDS.waveDictionaryData, "RWS dictionary data");
  if (!rootChunks.done) {
    throw new RenderWareParseError("RWS sound dictionary has unexpected root chunks");
  }

  const soundCount = view.u32(dictionaryData.dataOffset, "RWS sound count");
  const waveChunks = new ChunkCursor(
    view,
    dictionaryData.dataOffset + 4,
    dictionaryData.endOffset,
    "RWS wave list",
  );
  const sounds: RwsPcm16Sound[] = [];
  for (let index = 0; index < soundCount; index += 1) {
    const wave = waveChunks.expect(RW_CHUNK_IDS.wave, `RWS wave ${index}`);
    const children = new ChunkCursor(view, wave.dataOffset, wave.endOffset, `RWS wave ${index}`);
    const header = children.expect(RW_CHUNK_IDS.waveHeader, `RWS wave ${index} header`);
    const data = children.expect(RW_CHUNK_IDS.waveData, `RWS wave ${index} data`);
    if (!children.done) {
      throw new RenderWareParseError(`RWS wave ${index} has unexpected child chunks`);
    }
    if (header.length < 0x7c) {
      throw new RenderWareParseError(`RWS wave ${index} header is too small (${header.length} bytes)`);
    }

    const sampleRate = view.u32(header.dataOffset + 0x04, `RWS wave ${index} sample rate`);
    const declaredDataBytes = view.u32(header.dataOffset + 0x0c, `RWS wave ${index} data length`);
    const codecId = view.u32(header.dataOffset + 0x20, `RWS wave ${index} codec`);
    const name = view.ascii(
      header.dataOffset + 0x70,
      header.length - 0x70,
      `RWS wave ${index} name`,
    ).trim();
    if (sampleRate === 0 || sampleRate > 192_000) {
      throw new RenderWareParseError(`RWS wave ${index} has invalid sample rate ${sampleRate}`);
    }
    if (codecId !== RWA_PCM_CODEC_ID) {
      throw new RenderWareParseError(
        `RWS wave ${index} uses unsupported codec 0x${codecId.toString(16)}; expected PC PCM`,
      );
    }
    if (declaredDataBytes !== data.length) {
      throw new RenderWareParseError(
        `RWS wave ${index} declares ${declaredDataBytes} data bytes but contains ${data.length}`,
      );
    }
    if (name.length === 0) {
      throw new RenderWareParseError(`RWS wave ${index} has no name`);
    }
    sounds.push({
      name,
      sampleRate,
      channelCount: 1,
      pcm16: decodePcm16(view, data.dataOffset, data.length, `RWS wave ${index}`),
    });
  }
  if (!waveChunks.done) {
    throw new RenderWareParseError(`RWS sound dictionary contains more than ${soundCount} waves`);
  }
  return { sounds };
}
