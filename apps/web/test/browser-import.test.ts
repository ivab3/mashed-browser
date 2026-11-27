import { describe, expect, it } from "vitest";
import { buildImportedCatalog, collectImportFiles, readBrowserPiz, safeImportPath } from "../src/browser-import.js";

function piz(names = ["WILDFIRE0.DFF", "WILDFIRE.TXD"]): Blob {
  const start = 0x800 + names.length * 0x80;
  const buffer = new Uint8Array(start + names.length * 4);
  const view = new DataView(buffer.buffer);
  buffer.set([80, 73, 90, 0, 3, 0, 0, 0]);
  view.setUint32(8, names.length, true);
  names.forEach((name, index) => {
    const record = 0x800 + index * 0x80;
    buffer.set(new TextEncoder().encode(name), record);
    view.setUint32(record + 0x74, start + index * 4, true);
    view.setUint32(record + 0x78, 4, true);
    buffer.fill(index + 1, start + index * 4, start + index * 4 + 4);
  });
  return new Blob([buffer]);
}

function courseFiles(): Map<string, Blob> {
  const prefix = "toastart/tracks/arctic/";
  return new Map([
    [`${prefix}course.lua`, new Blob([`Course_Id(0)\nAI_Bsp_Filename("AI.BSP")\nCollision_Bsp_Filename("COLLISIONS.BSP")\nWorld_Bsp_Filename("GRAPH.BSP")\nTexture_Dictionary_Filename("TEXTURES.TXD")`])],
    ...["ai.bsp", "collisions.bsp", "graph.bsp", "textures.txd", "lapdata.lua"].map((name): [string, Blob] => [prefix + name, new Blob(["fixture"])]),
    ["toastart/vehicles/wildfire/wildfire0.dff", new Blob(["model"])],
    ["toastart/vehicles/wildfire/wildfire.txd", new Blob(["texture"])],
  ]);
}

describe("browser directory import", () => {
  it("reads original uncompressed PIZ layout using bounded Blob slices", async () => {
    const entries = await readBrowserPiz(piz());
    expect(entries.map((entry) => entry.path)).toEqual(["wildfire0.dff", "wildfire.txd"]);
    expect([...new Uint8Array(await entries[1]!.blob.arrayBuffer())]).toEqual([2, 2, 2, 2]);
  });

  it("rejects traversal, absolute paths, case collisions and truncated archives", async () => {
    for (const path of ["../secret", "/tmp/file", "a/../b", "C:\\file", "a//b", "a/./b", "a\u0000b"]) {
      expect(() => safeImportPath(path)).toThrow();
    }
    await expect(readBrowserPiz(piz(["../escape.dff"]))).rejects.toThrow("Unsafe");
    await expect(readBrowserPiz(piz(["CAR.DFF", "car.dff"]))).rejects.toThrow("colliding");
    await expect(readBrowserPiz(piz().slice(0, 0x800))).rejects.toThrow("table");
    await expect(readBrowserPiz(piz().slice(0, -1))).rejects.toThrow("bounds");
    await expect(readBrowserPiz(new Blob(["not a PIZ"]))).rejects.toThrow("signature");
  });

  it("imports installed archives, ignores executables and prefers archives over expanded duplicates", async () => {
    const files = await collectImportFiles([
      { path: "Game/files/TOASTART/VEHICLES/Wildfire.piz", blob: piz() },
      { path: "Game/expanded/piz/TOASTART/VEHICLES/Wildfire/WILDFIRE0.DFF", blob: new Blob(["expanded"]) },
      { path: "Game/MFL.exe", blob: new Blob(["executable"]) },
    ]);
    expect([...files.keys()]).toEqual(["toastart/vehicles/wildfire/wildfire.txd", "toastart/vehicles/wildfire/wildfire0.dff"]);
    expect(files.get("toastart/vehicles/wildfire/wildfire0.dff")?.size).toBe(4);
  });

  it("rejects mixed installations and unrelated folders with an actionable error", async () => {
    await expect(collectImportFiles([
      { path: "one/TOASTART/VEHICLES/Wildfire.piz", blob: piz() },
      { path: "two/TOASTART/VEHICLES/Wildfire.piz", blob: piz() },
    ])).rejects.toThrow("Duplicate archive");
    await expect(collectImportFiles([{ path: "image/game.bin", blob: new Blob(["disc"]) }])).rejects.toThrow("Import disc image");
  });

  it("supports expanded data and nonstandard course-declared filenames without server URLs", async () => {
    const sources = [...courseFiles()].map(([path, blob]) => ({ path: `game-data/expanded/piz/${path}`, blob }));
    const catalog = await buildImportedCatalog(await collectImportFiles(sources));
    expect(catalog.tracks.filter((track) => track.available).map((track) => track.id)).toEqual(["arctic-0"]);
    expect(catalog.vehicles.filter((vehicle) => vehicle.available).map((vehicle) => vehicle.id)).toEqual(["wildfire"]);
    expect(catalog.tracks.find((track) => track.available)?.files.every((file) => file.url.startsWith("cache:"))).toBe(true);
  });

  it("rejects incomplete bundles and mismatched course identities before activation", async () => {
    const missing = courseFiles();
    missing.delete("toastart/tracks/arctic/collisions.bsp");
    await expect(buildImportedCatalog(missing)).rejects.toThrow("COLLISIONS.BSP");
    const noTexture = courseFiles();
    noTexture.delete("toastart/vehicles/wildfire/wildfire.txd");
    await expect(buildImportedCatalog(noTexture)).rejects.toThrow("incomplete vehicle");
    const mismatch = courseFiles();
    mismatch.set("toastart/tracks/arctic/course.lua", new Blob(["Course_Id(33)"]));
    await expect(buildImportedCatalog(mismatch)).rejects.toThrow("unsupported course ID");
  });
});
