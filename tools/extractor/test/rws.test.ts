import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readRws } from "../src/rws.js";

describe("RWS reader", () => {
  it("indexes consecutive top-level chunks", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-rws-test-"));
    const rwsPath = join(directory, "fixture.rws");
    const first = Buffer.alloc(15);
    first.writeUInt32LE(0x809, 0);
    first.writeUInt32LE(3, 4);
    first.writeUInt32LE(0x1c020018, 8);
    first.fill(0xaa, 12);
    const second = Buffer.alloc(12);
    second.writeUInt32LE(1, 0);
    second.writeUInt32LE(0, 4);
    second.writeUInt32LE(2, 8);
    writeFileSync(rwsPath, Buffer.concat([first, second]));

    expect(readRws(rwsPath).chunks).toEqual([
      {
        id: 0x809,
        idHex: "0x00000809",
        offset: 0,
        payloadSizeBytes: 3,
        libraryId: 0x1c020018,
      },
      { id: 1, idHex: "0x00000001", offset: 15, payloadSizeBytes: 0, libraryId: 2 },
    ]);
  });

  it("rejects a chunk whose payload exceeds the file", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-rws-test-"));
    const rwsPath = join(directory, "fixture.rws");
    const fixture = Buffer.alloc(12);
    fixture.writeUInt32LE(0x809, 0);
    fixture.writeUInt32LE(1, 4);
    writeFileSync(rwsPath, fixture);
    expect(() => readRws(rwsPath)).toThrow("exceeds the file");
  });
});
