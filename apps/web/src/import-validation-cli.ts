import { openAsBlob } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { buildImportedCatalog, collectImportFiles, type ImportSource } from "./browser-import.js";
import { validateImportedResource } from "./import-validation.js";

const root = resolve(process.argv.slice(2).find((argument) => argument !== "--") ?? "game-data/files");
async function walk(directory: string): Promise<ImportSource[]> {
  const files: ImportSource[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push({ path: relative(root, path), blob: await openAsBlob(path) });
  }
  return files;
}
const files = await collectImportFiles(await walk(root));
const catalog = await buildImportedCatalog(files);
let bytes = 0;
for (const [path, blob] of files) {
  try { validateImportedResource(path, await blob.arrayBuffer()); }
  catch (error) { throw new Error(`${path}: ${String(error)}`); }
  bytes += blob.size;
}
console.log(JSON.stringify({ files: files.size, bytes,
  tracks: catalog.tracks.filter((track) => track.available).map((track) => track.id),
  vehicles: catalog.vehicles.filter((vehicle) => vehicle.available).length,
  paints: catalog.vehicles.reduce((sum, vehicle) => sum + vehicle.variants.length, 0),
}, null, 2));
