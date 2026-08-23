import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ISO_SECTOR_SIZE, Mode1IsoReader, RAW_SECTOR_SIZE } from "../src/mode1.js";

function sector(fill: number): Buffer {
  const value = Buffer.alloc(RAW_SECTOR_SIZE);
  value[0] = 0;
  value.fill(0xff, 1, 11);
  value[11] = 0;
  value[15] = 1;
  value.fill(fill, 16, 16 + ISO_SECTOR_SIZE);
  return value;
}

describe("Mode1IsoReader", () => {
  it("reads logical sectors after the CUE track offset", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-mode1-test-"));
    const binPath = join(directory, "game.bin");
    writeFileSync(binPath, Buffer.concat([sector(0x11), sector(0x22), sector(0x33)]));
    const reader = new Mode1IsoReader(binPath, 1);
    try {
      expect(reader.sectorCount).toBe(2);
      expect(reader.readSector(0)).toEqual(Buffer.alloc(ISO_SECTOR_SIZE, 0x22));
      expect(reader.readIsoBytes(ISO_SECTOR_SIZE - 2, 4)).toEqual(
        Buffer.from([0x22, 0x22, 0x33, 0x33]),
      );
    } finally {
      reader.close();
    }
  });

  it("rejects a sector without the CD-ROM sync header", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-mode1-test-"));
    const binPath = join(directory, "game.bin");
    writeFileSync(binPath, Buffer.alloc(RAW_SECTOR_SIZE));
    const reader = new Mode1IsoReader(binPath);
    try {
      expect(() => reader.readSector(0)).toThrow("invalid CD-ROM sync header");
    } finally {
      reader.close();
    }
  });
});
