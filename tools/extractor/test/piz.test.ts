import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractPiz, readPiz } from "../src/piz.js";

function pizFixture(name = "NESTED/FILE.LUA"): Buffer {
  const data = Buffer.from("fixture payload");
  const offset = 0x1000;
  const fixture = Buffer.alloc(offset + data.length);
  Buffer.from([0x50, 0x49, 0x5a, 0, 3, 0, 0, 0]).copy(fixture);
  fixture.writeUInt32LE(1, 8);
  fixture.fill(0xcc, 0x0c, 0x10);
  fixture.write(name, 0x800, "latin1");
  fixture.writeUInt32LE(offset, 0x800 + 0x74);
  fixture.writeUInt32LE(data.length, 0x800 + 0x78);
  fixture.writeUInt32LE(0x1234, 0x800 + 0x7c);
  data.copy(fixture, offset);
  return fixture;
}

describe("PIZ reader", () => {
  it("reads and extracts a bounds-checked entry", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-piz-test-"));
    const pizPath = join(directory, "fixture.piz");
    const outputPath = join(directory, "output");
    writeFileSync(pizPath, pizFixture());

    const archive = readPiz(pizPath);
    expect(archive).toEqual({
      entryCount: 1,
      appendix: "cc",
      entries: [
        {
          name: "NESTED/FILE.LUA",
          offset: 0x1000,
          sizeBytes: 15,
          flags: 0x1234,
        },
      ],
    });
    extractPiz(pizPath, archive, outputPath);
    expect(readFileSync(join(outputPath, "NESTED", "FILE.LUA"), "utf8")).toBe("fixture payload");
  });

  it("rejects traversal in entry names", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-piz-test-"));
    const pizPath = join(directory, "fixture.piz");
    writeFileSync(pizPath, pizFixture("../escape.lua"));
    expect(() => readPiz(pizPath)).toThrow("Unsafe PIZ entry path");
  });

  it("rejects entries outside the archive", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-piz-test-"));
    const pizPath = join(directory, "fixture.piz");
    const fixture = pizFixture();
    fixture.writeUInt32LE(fixture.length, 0x800 + 0x78);
    writeFileSync(pizPath, fixture);
    expect(() => readPiz(pizPath)).toThrow("exceeds archive");
  });
});
