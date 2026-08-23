import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCue } from "../src/cue.js";

describe("parseCue", () => {
  it("resolves the BIN and converts INDEX 01 to a sector offset", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-cue-test-"));
    const cuePath = join(directory, "game.cue");
    writeFileSync(join(directory, "game.bin"), "fixture");
    writeFileSync(
      cuePath,
      'FILE "game.bin" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 01:02:03\n',
    );

    expect(parseCue(cuePath)).toEqual({
      binPath: join(directory, "game.bin"),
      dataStartSector: (60 + 2) * 75 + 3,
      trackMode: "MODE1/2352",
    });
  });

  it("rejects unsupported multi-track images", () => {
    const directory = mkdtempSync(join(tmpdir(), "mashed-cue-test-"));
    mkdirSync(join(directory, "nested"));
    const cuePath = join(directory, "game.cue");
    writeFileSync(join(directory, "game.bin"), "fixture");
    writeFileSync(
      cuePath,
      'FILE "game.bin" BINARY\n  TRACK 01 MODE1/2352\n    INDEX 01 00:00:00\n  TRACK 02 AUDIO\n    INDEX 01 00:02:00\n',
    );

    expect(() => parseCue(cuePath)).toThrow("Expected one track");
  });
});
