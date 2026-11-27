import { parseCourseLua } from "@mashed/assets";
import {
  LOCAL_TRACK_SOURCES, LOCAL_VEHICLE_SOURCES,
  type LocalContentCatalog, type LocalContentFile,
} from "./local-content-catalog.js";

export interface ImportSource { path: string; blob: Blob }
export interface ImportProgress { completed: number; total: number; label: string; unit?: "bytes" }
export type ImportFiles = Map<string, Blob>;
const extensions = /\.(bsp|dff|lua|mts|txd)$/;

export function safeImportPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  if (!normalized || normalized.startsWith("/") || /[:\x00-\x1f]/.test(normalized)
    || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe resource path: ${path}`);
  }
  return normalized;
}

function canonicalPath(path: string): string | undefined {
  const parts = safeImportPath(path).split("/");
  const start = parts.findIndex((part) => part === "toastart" || part === "toastaudio");
  return start < 0 ? undefined : parts.slice(start).join("/");
}

function wanted(path: string): boolean {
  if (path === "toastart/common/sfx/trackimages.txd"
    || path === "toastart/common/powerups/powerups/powerups_all.lua"
    || path === "toastaudio/pc/audio/pcdics/permdict.rws") return true;
  if (LOCAL_TRACK_SOURCES.some((track) => path === `toastart/common/ai/ai${track.courseId}.ai`
    || path === `toastart/common/led/le${track.courseId}.led`)) return true;
  if (LOCAL_TRACK_SOURCES.some((track) => path.startsWith(`toastart/tracks/${track.directoryName.toLowerCase()}/`))) {
    return extensions.test(path);
  }
  return LOCAL_VEHICLE_SOURCES.some((vehicle) => {
    const prefix = `toastart/vehicles/${vehicle.directoryName.toLowerCase()}/${vehicle.assetBaseName.toLowerCase()}`;
    return path === `${prefix}.txd` || vehicle.variants.some((variant) => path === `${prefix}${variant}.dff`);
  });
}

export function wantedArchive(path: string): boolean {
  return LOCAL_TRACK_SOURCES.some((track) => path === `toastart/tracks/${track.directoryName.toLowerCase()}.piz`)
    || LOCAL_VEHICLE_SOURCES.some((vehicle) => path === `toastart/vehicles/${vehicle.directoryName.toLowerCase()}.piz`)
    || ["toastart/common/sfx.piz", "toastart/common/ai.piz", "toastart/common/led.piz",
      "toastart/common/powerups/powerups.piz"].includes(path);
}

/** Reads only the bounded table; payloads remain Blob slices, never a whole archive buffer. */
export async function readBrowserPiz(blob: Blob): Promise<ImportSource[]> {
  const header = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (header.length !== 16 || ![80, 73, 90, 0, 3, 0, 0, 0].every((v, i) => header[i] === v)) {
    throw new Error("Invalid PIZ signature or truncated header");
  }
  const count = new DataView(header.buffer).getUint32(8, true);
  const end = 0x800 + count * 0x80;
  if (count < 1 || count > 4096 || end > blob.size) throw new Error("PIZ file table exceeds archive");
  if (![0, 0xcc].includes(header[12]!) || !header.slice(12).every((v) => v === header[12])) {
    throw new Error("Unsupported PIZ header appendix");
  }
  const table = new Uint8Array(await blob.slice(0x800, end).arrayBuffer());
  const view = new DataView(table.buffer);
  const names = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const start = index * 0x80;
    const bytes = table.slice(start, start + 0x73);
    const zero = bytes.indexOf(0);
    const path = safeImportPath(String.fromCharCode(...bytes.slice(0, zero < 0 ? bytes.length : zero)));
    if (names.has(path)) throw new Error(`PIZ contains colliding entry names: ${path}`);
    names.add(path);
    const offset = view.getUint32(start + 0x74, true);
    const size = view.getUint32(start + 0x78, true);
    if (offset < end || offset + size > blob.size) throw new Error(`PIZ entry exceeds payload bounds: ${path}`);
    return { path, blob: blob.slice(offset, offset + size) };
  });
}

export async function collectImportFiles(
  sources: readonly ImportSource[], progress: (value: ImportProgress) => void = () => {},
): Promise<ImportFiles> {
  const files: ImportFiles = new Map();
  const indexed = sources.flatMap((source) => {
    const path = canonicalPath(source.path);
    return path ? [{ ...source, path }] : [];
  });
  const archives = indexed.filter((source) => wantedArchive(source.path));
  // Selecting the extractor output root includes both archives and their expanded copies.
  // Prefer archives consistently; do not silently choose between two distinct installations.
  const archiveRoots = archives.map((source) => source.path.slice(0, -4) + "/");
  const selected = indexed.filter((source) => wantedArchive(source.path)
    || (wanted(source.path) && !archiveRoots.some((prefix) => source.path.startsWith(prefix))));
  const add = (path: string, blob: Blob): void => {
    if (!wanted(path)) return;
    if (files.has(path)) throw new Error(`Duplicate resource: ${path}. Select one installation.`);
    if (blob.size === 0 || blob.size > 256 * 1024 * 1024) throw new Error(`Invalid resource size: ${path}`);
    files.set(path, blob);
  };
  const seenArchives = new Set<string>();
  for (const [index, source] of selected.entries()) {
    progress({ completed: index, total: selected.length, label: `Reading ${source.path}` });
    if (wantedArchive(source.path)) {
      if (seenArchives.has(source.path)) throw new Error(`Duplicate archive: ${source.path}. Select one installation.`);
      seenArchives.add(source.path);
      try {
        for (const entry of await readBrowserPiz(source.blob)) add(`${source.path.slice(0, -4)}/${entry.path}`, entry.blob);
      } catch (error) {
        throw new Error(`${source.path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else add(source.path, source.blob);
  }
  if (!files.size) throw new Error("No supported game data found. Choose the installed game folder or extracted game-data folder. For a disc image, use Import disc image and select both CUE and BIN.");
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}

export async function buildImportedCatalog(files: ImportFiles): Promise<LocalContentCatalog> {
  const file = (path: string): LocalContentFile | undefined => files.has(path.toLowerCase())
    ? { name: path.split("/").at(-1)!, url: `cache:${path.toLowerCase()}` } : undefined;
  const tracks = await Promise.all(LOCAL_TRACK_SOURCES.map(async (track) => {
    const prefix = `toastart/tracks/${track.directoryName.toLowerCase()}/`;
    const paths = [...files.keys()].filter((path) => path.startsWith(prefix));
    if (paths.length) {
      const courseBlob = files.get(`${prefix}course.lua`);
      if (!courseBlob) throw new Error(`${track.displayName}: missing COURSE.LUA`);
      const course = parseCourseLua(await courseBlob.text());
      if (course.id !== track.courseId) throw new Error(`${track.displayName}: unsupported course ID ${course.id}`);
      for (const name of [course.worldBspFileName, course.collisionBspFileName,
        course.aiBspFileName, course.textureDictionaryFileName, "LAPDATA.LUA"]) {
        if (!name || !files.has(prefix + safeImportPath(name))) throw new Error(`${track.displayName}: missing required resource ${name ?? "in COURSE.LUA"}`);
      }
      if (track.powerupLoadoutPath && !files.has(`toastart/${track.powerupLoadoutPath.toLowerCase()}`)) {
        throw new Error(`${track.displayName}: missing shared power-up definitions`);
      }
    }
    const trackFiles = paths.map((path) => file(path)!);
    if (paths.length) for (const path of [
      `toastart/common/ai/ai${track.courseId}.ai`, `toastart/common/led/le${track.courseId}.led`,
      ...(track.powerupLoadoutPath ? [`toastart/${track.powerupLoadoutPath.toLowerCase()}`] : []),
      "toastaudio/pc/audio/pcdics/permdict.rws",
    ]) { const optional = file(path); if (optional) trackFiles.push(optional); }
    return { ...track, available: paths.length > 0, files: trackFiles };
  }));
  const vehicles = LOCAL_VEHICLE_SOURCES.map((vehicle) => {
    const prefix = `toastart/vehicles/${vehicle.directoryName}/${vehicle.assetBaseName}`;
    const texture = file(`${prefix}.TXD`);
    const variants = vehicle.variants.flatMap((variant) => {
      const model = file(`${prefix}${variant}.DFF`);
      return model ? [{ variant, model }] : [];
    });
    if ((texture || variants.length) && (!texture || !variants.length)) throw new Error(`${vehicle.displayName}: incomplete vehicle model/texture pair`);
    return { ...vehicle, available: Boolean(texture && variants.length), ...(texture ? { texture } : {}), variants };
  });
  if (!tracks.some((track) => track.available) || !vehicles.some((vehicle) => vehicle.available)) {
    throw new Error("Choose a folder containing at least one supported track and one complete vehicle.");
  }
  const previewDictionary = file("toastart/common/sfx/trackimages.txd");
  return { version: 1, tracks, vehicles, ...(previewDictionary ? { previewDictionary } : {}) };
}
