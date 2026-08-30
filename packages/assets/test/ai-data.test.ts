import { describe, expect, it } from "vitest";

import {
  AI_DATA_CHUNK_ID,
  AI_GRID_HEIGHT,
  AI_GRID_WIDTH,
  AI_TABLE_CAPACITY,
  LED_DATA_CHUNK_ID,
  RenderWareParseError,
  parseAiData,
  parseLedData,
} from "../src/index.js";

const LIBRARY_ID = 0x1c02_000a;
const AI_PAYLOAD_BYTES = 71_812;
const LED_PAYLOAD_BYTES = 4_608;

function chunk(id: number, payloadBytes: number): Uint8Array {
  const bytes = new Uint8Array(12 + payloadBytes);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, id, true);
  view.setUint32(4, payloadBytes, true);
  view.setUint32(8, LIBRARY_ID, true);
  return bytes;
}

describe("original AI/LED data readers", () => {
  it("decodes the fixed AI grid and neutral table structure", () => {
    const bytes = chunk(AI_DATA_CHUNK_ID, AI_PAYLOAD_BYTES);
    const view = new DataView(bytes.buffer);
    bytes.fill(0xff, 12, 12 + AI_GRID_WIDTH * AI_GRID_HEIGHT);
    bytes[12 + 513] = 7;
    const countOffset = 12 + AI_GRID_WIDTH * AI_GRID_HEIGHT;
    view.setUint32(countOffset, 356, true);
    const tableAOffset = countOffset + 4;
    const tableBOffset = tableAOffset + AI_TABLE_CAPACITY * 8;
    view.setFloat32(tableAOffset, -25.75, true);
    view.setFloat32(tableAOffset + 4, 16.5, true);
    view.setFloat32(tableBOffset, 4.25, true);
    view.setFloat32(tableBOffset + 4, -2.5, true);
    bytes[bytes.length - 1] = 0x2a;

    const parsed = parseAiData(bytes);
    expect(parsed.libraryId).toBe(LIBRARY_ID);
    expect(parsed.grid).toMatchObject({ width: 256, height: 256 });
    expect(parsed.grid.cells[513]).toBe(7);
    expect(parsed.declaredEntryCount).toBe(356);
    expect(parsed.tableA).toHaveLength(384);
    expect(parsed.tableA[0]).toEqual([-25.75, 16.5]);
    expect(parsed.tableB[0]).toEqual([4.25, -2.5]);
    expect(parsed.trailer).toHaveLength(128);
    expect(parsed.trailer.at(-1)).toBe(0x2a);
  });

  it("decodes all 384 LED float triplets", () => {
    const bytes = chunk(LED_DATA_CHUNK_ID, LED_PAYLOAD_BYTES);
    const view = new DataView(bytes.buffer);
    view.setFloat32(12, 15, true);
    view.setFloat32(16, 270, true);
    view.setFloat32(20, -1, true);

    const parsed = parseLedData(bytes);
    expect(parsed.libraryId).toBe(LIBRARY_ID);
    expect(parsed.entries).toHaveLength(384);
    expect(parsed.entries[0]).toEqual([15, 270, -1]);
    expect(parsed.entries.at(-1)).toEqual([0, 0, 0]);
  });

  it("rejects wrong chunk IDs, sizes, and non-finite table values", () => {
    expect(() => parseAiData(chunk(LED_DATA_CHUNK_ID, AI_PAYLOAD_BYTES)))
      .toThrow(RenderWareParseError);
    expect(() => parseLedData(chunk(LED_DATA_CHUNK_ID, LED_PAYLOAD_BYTES - 4)))
      .toThrow(RenderWareParseError);
    const invalid = chunk(LED_DATA_CHUNK_ID, LED_PAYLOAD_BYTES);
    new DataView(invalid.buffer).setFloat32(12, Number.NaN, true);
    expect(() => parseLedData(invalid)).toThrow(/not finite/);
  });
});
