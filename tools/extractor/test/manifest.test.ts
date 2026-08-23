import { describe, expect, it } from "vitest";

import { buildSummary, classifyFile, type ManifestFile } from "../src/manifest.js";

function file(path: string): ManifestFile {
  return {
    path,
    type: classifyFile(path),
    sizeBytes: 1,
    sha256: "0".repeat(64),
    origin: { kind: "installed-directory", sourcePath: path },
  };
}

describe("manifest", () => {
  it("classifies core resource types", () => {
    expect(classifyFile("CAR.DFF")).toBe("model-dff");
    expect(classifyFile("TRACK.BSP")).toBe("world-bsp");
    expect(classifyFile("VOICE.RWS")).toBe("audio-rws");
  });

  it("detects all Gate A representative assets", () => {
    const summary = buildSummary([
      file("files/MFL.exe"),
      file("files/TOASTART/VEHICLES/Wildfire.piz"),
      file("files/TOASTART/TRACKS/Warzone.piz"),
      file("expanded/piz/TOASTART/TRACKS/Warzone/COURSE.LUA"),
      file("files/audio/warzone.rws"),
      file("files/movies/frontend.mpg"),
    ]);
    expect(Object.values(summary.required).every((item) => item.found)).toBe(true);
  });
});
