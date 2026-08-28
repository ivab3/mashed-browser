import { describe, expect, it } from "vitest";

import {
  parseRwsSoundDictionary,
  RenderWareParseError,
  RWA_PCM_CODEC_ID,
  RW_CHUNK_IDS,
} from "../src/index.js";

const LIBRARY_ID = 0x1c020018;

function chunk(id: number, payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(12 + payload.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, id, true);
  view.setUint32(4, payload.length, true);
  view.setUint32(8, LIBRARY_ID, true);
  result.set(payload, 12);
  return result;
}

function join(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function dictionary(codecId = RWA_PCM_CODEC_ID, declaredDataBytes = 6): Uint8Array {
  const pcm = new Uint8Array(6);
  const pcmView = new DataView(pcm.buffer);
  pcmView.setInt16(0, -32_768, true);
  pcmView.setInt16(2, 0, true);
  pcmView.setInt16(4, 32_767, true);

  const header = new Uint8Array(0xa0);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0x04, 22_050, true);
  headerView.setUint32(0x0c, declaredDataBytes, true);
  headerView.setUint32(0x20, codecId, true);
  header.set(new TextEncoder().encode("machineg\0"), 0x70);
  const wave = chunk(
    RW_CHUNK_IDS.wave,
    join(chunk(RW_CHUNK_IDS.waveHeader, header), chunk(RW_CHUNK_IDS.waveData, pcm)),
  );
  const data = new Uint8Array(4 + wave.length);
  new DataView(data.buffer).setUint32(0, 1, true);
  data.set(wave, 4);
  return chunk(
    RW_CHUNK_IDS.waveDictionary,
    join(
      chunk(RW_CHUNK_IDS.waveDictionaryHeader, new Uint8Array(0x44)),
      chunk(RW_CHUNK_IDS.waveDictionaryData, data),
    ),
  );
}

describe("RenderWare sound dictionary reader", () => {
  it("decodes named little-endian mono PCM16 waves", () => {
    expect(parseRwsSoundDictionary(dictionary())).toEqual({
      sounds: [{
        name: "machineg",
        sampleRate: 22_050,
        channelCount: 1,
        pcm16: new Int16Array([-32_768, 0, 32_767]),
      }],
    });
  });

  it("rejects non-PC codecs and inconsistent payload sizes", () => {
    expect(() => parseRwsSoundDictionary(dictionary(0x632fa22b))).toThrow(RenderWareParseError);
    expect(() => parseRwsSoundDictionary(dictionary(RWA_PCM_CODEC_ID, 8))).toThrow(
      "declares 8 data bytes but contains 6",
    );
  });
});
