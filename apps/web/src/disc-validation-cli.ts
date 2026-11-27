import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { buildImportedCatalog, collectImportFiles } from "./browser-import.js";
import { extractDiscSources } from "./disc-import.js";
import { parseBrowserCue } from "./disc-reader.js";
import { validateImportedResource } from "./import-validation.js";

const argument = process.argv.slice(2).find(value => value !== "--");
if (!argument) throw new Error("Usage: pnpm disc:validate /path/to/game.cue");
const cuePath = resolve(argument);
const cue = parseBrowserCue(await readFile(cuePath, "utf8"));
const binName = (await readdir(dirname(cuePath))).find(name => name.toLowerCase() === cue.binName);
if (!binName) throw new Error(`Missing ${cue.binName}`);
const started = performance.now();
const extracted = await extractDiscSources([
  { path: basename(cuePath), blob: await openAsBlob(cuePath) },
  { path: binName, blob: await openAsBlob(join(dirname(cuePath), binName)) },
]);
// Compare the browser's decompressed PIZ/RWS bytes with the CLI extraction already present locally.
async function findCaseInsensitive(root: string, path: string): Promise<string> {
  let current = root;
  for (const segment of path.split("/")) {
    const name = (await readdir(current)).find(name => name.toLowerCase() === segment);
    if (!name) throw new Error(`Missing CLI comparison resource ${path}`);
    current = join(current, name);
  }
  return current;
}
for (const source of extracted.sources) {
  const expected = await readFile(await findCaseInsensitive(resolve("game-data/files"), source.path));
  const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
  if (hash(expected) !== hash(new Uint8Array(await source.blob.arrayBuffer()))) throw new Error(`CLI hash mismatch: ${source.path}`);
}
const files = await collectImportFiles(extracted.sources);
const catalog = await buildImportedCatalog(files);
let bytes = 0;
for (const [path, blob] of files) {
  validateImportedResource(path, await blob.arrayBuffer());
  bytes += blob.size;
}
console.log(JSON.stringify({ comparedArchives: extracted.sources.length, rawBytesRead: extracted.rawBytesRead,
  files: files.size, bytes, tracks: catalog.tracks.filter(t => t.available).map(t => t.id),
  vehicles: catalog.vehicles.filter(v => v.available).length,
  paints: catalog.vehicles.reduce((sum, v) => sum + v.variants.length, 0),
  seconds: (performance.now() - started) / 1000,
}, null, 2));
