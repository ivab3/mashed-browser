import { safeImportPath } from "./browser-import.js";

export interface RandomAccessData {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
}
export type CheckImport = () => void;
export function requireDisc(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function checkRange(size: number, offset: number, length: number): void {
  requireDisc(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0
    && offset + length <= size, "Disc/archive byte range is out of bounds");
}

export function parseBrowserCue(text: string): { binName: string; startSector: number } {
  requireDisc(text.length <= 65536, "CUE is too large");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const files = lines.filter((line) => /^FILE\b/i.test(line));
  const tracks = lines.filter((line) => /^TRACK\b/i.test(line));
  const indices = lines.filter((line) => /^INDEX\s+01\b/i.test(line));
  requireDisc(files.length === 1 && tracks.length === 1 && indices.length === 1,
    "Select a single-track CUE with one BINARY file and one INDEX 01");
  const file = /^FILE\s+(?:"([^"]+)"|(\S+))\s+BINARY$/i.exec(files[0]!);
  requireDisc(file, "CUE must reference a BINARY file");
  requireDisc(/^TRACK\s+\d+\s+MODE1\/2352$/i.test(tracks[0]!), "Only MODE1/2352 disc images are supported");
  const path = safeImportPath(file[1] ?? file[2]!);
  requireDisc(!path.includes("/"), "CUE must reference a BIN in the same folder (no directory paths)");
  const index = /^INDEX\s+01\s+(\d{1,3}):(\d{2}):(\d{2})$/i.exec(indices[0]!);
  requireDisc(index && Number(index[2]) < 60 && Number(index[3]) < 75, "Invalid CUE INDEX 01 timestamp");
  requireDisc(lines.indexOf(files[0]!) < lines.indexOf(tracks[0]!)
    && lines.indexOf(tracks[0]!) < lines.indexOf(indices[0]!), "Invalid CUE FILE/TRACK/INDEX order");
  return { binName: path, startSector: (Number(index[1]) * 60 + Number(index[2])) * 75 + Number(index[3]) };
}

/** Read at most 256 raw sectors per I/O, preserving MODE1 validation without copying the entire CD. */
export class BrowserMode1Reader implements RandomAccessData {
  readonly size: number;
  bytesRead = 0;
  constructor(private readonly bin: Blob, private readonly startSector = 0, private readonly check: CheckImport = () => {}) {
    requireDisc(bin.size > 0 && bin.size % 2352 === 0, "BIN size must be a multiple of 2352 bytes");
    requireDisc(Number.isSafeInteger(startSector) && startSector >= 0 && startSector < bin.size / 2352,
      "CUE data start is outside the BIN");
    this.size = (bin.size / 2352 - startSector) * 2048;
  }
  async read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
    checkRange(this.size, offset, length);
    const result = new Uint8Array(length);
    let copied = 0;
    while (copied < length) {
      this.check();
      const logical = offset + copied;
      const first = Math.floor(logical / 2048);
      const within = logical % 2048;
      const count = Math.min(256, Math.ceil((within + length - copied) / 2048));
      const rawOffset = (this.startSector + first) * 2352;
      const raw = new Uint8Array(await this.bin.slice(rawOffset, rawOffset + count * 2352).arrayBuffer());
      this.bytesRead += raw.byteLength;
      requireDisc(raw.length === count * 2352, "Truncated MODE1 sector batch");
      for (let i = 0; i < count; i++) {
        const p = i * 2352;
        requireDisc(raw[p] === 0 && raw[p + 11] === 0 && raw.subarray(p + 1, p + 11).every((v) => v === 255),
          `Invalid CD-ROM sync at sector ${first + i}`);
        requireDisc(raw[p + 15] === 1, `Sector ${first + i} is not MODE1`);
        const begin = i === 0 ? within : 0;
        const amount = Math.min(2048 - begin, length - copied);
        result.set(raw.subarray(p + 16 + begin, p + 16 + begin + amount), copied);
        copied += amount;
      }
    }
    this.check();
    return result;
  }
}

export interface DiscEntry { path: string; offset: number; size: number; directory: boolean }
function record(bytes: Uint8Array): DiscEntry {
  requireDisc(bytes.length >= 34, "Truncated ISO directory record");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = bytes[32]!;
  requireDisc(length > 0 && 33 + length <= bytes.length, "Invalid ISO file name length");
  requireDisc(view.getUint32(2, true) === view.getUint32(6) && view.getUint32(10, true) === view.getUint32(14),
    "ISO extent byte-order mismatch");
  requireDisc(bytes[1] === 0 && bytes[26] === 0 && bytes[27] === 0 && (bytes[25]! & 0x80) === 0,
    "Extended/interleaved/multi-extent ISO files are unsupported");
  const name = bytes.subarray(33, 33 + length);
  const path = length === 1 && name[0] === 0 ? "." : length === 1 && name[0] === 1 ? ".."
    : String.fromCharCode(...name).replace(/;\d+$/, "");
  return { path, offset: view.getUint32(2, true) * 2048, size: view.getUint32(10, true), directory: Boolean(bytes[25]! & 2) };
}

export async function readBrowserIso(reader: RandomAccessData, check: CheckImport = () => {}): Promise<DiscEntry[]> {
  const pvd = await reader.read(16 * 2048, 2048);
  requireDisc(pvd[0] === 1 && String.fromCharCode(...pvd.subarray(1, 6)) === "CD001" && pvd[6] === 1,
    "Disc is not an ISO 9660 MODE1 image");
  const view = new DataView(pvd.buffer);
  requireDisc(view.getUint16(128, true) === 2048 && view.getUint16(130) === 2048, "Unsupported ISO block size");
  const sectors = view.getUint32(80, true);
  requireDisc(sectors === view.getUint32(84) && sectors >= 17 && sectors * 2048 <= reader.size,
    "ISO volume size exceeds the image or has inconsistent byte order");
  const volumeSize = sectors * 2048;
  const root = record(pvd.subarray(156, 156 + pvd[156]!));
  requireDisc(root.directory, "ISO root is not a directory");
  const entries: DiscEntry[] = [];
  const visited = new Set<number>();
  const names = new Set<string>();
  let directoryBytes = 0;
  const visit = async (directory: DiscEntry, parent: string, depth: number): Promise<void> => {
    check();
    requireDisc(depth <= 16 && !visited.has(directory.offset), "ISO directory cycle or excessive depth");
    visited.add(directory.offset);
    directoryBytes += directory.size;
    requireDisc(directory.size <= 4 * 1024 * 1024 && directoryBytes <= 16 * 1024 * 1024, "ISO directory budget exceeded");
    checkRange(volumeSize, directory.offset, directory.size);
    const data = await reader.read(directory.offset, directory.size);
    for (let position = 0; position < data.length;) {
      check();
      const size = data[position]!;
      if (size === 0) { position = (Math.floor(position / 2048) + 1) * 2048; continue; }
      requireDisc(position + size <= data.length && position % 2048 + size <= 2048, "ISO record crosses extent/sector bounds");
      const entry = record(data.subarray(position, position + size));
      position += size;
      if (entry.path === "." || entry.path === "..") continue;
      const leaf = safeImportPath(entry.path);
      requireDisc(!leaf.includes("/"), "ISO record contains a directory separator");
      entry.path = parent ? `${parent}/${leaf}` : leaf;
      // The reference CD's final manual extends past the PVD volume size, but stays inside
      // the MODE1 track. Bound file extents by the actual track; directory metadata remains
      // bounded by the declared volume above. Unselected manuals are never read.
      checkRange(reader.size, entry.offset, entry.size);
      requireDisc(!names.has(entry.path), `Duplicate ISO path: ${entry.path}`);
      names.add(entry.path);
      entries.push(entry);
      requireDisc(entries.length <= 10000, "Too many ISO entries");
      if (entry.directory) await visit(entry, entry.path, depth + 1);
    }
  };
  await visit(root, "", 0);
  return entries;
}

export function discExtent(reader: RandomAccessData, entry: DiscEntry): RandomAccessData {
  return { size: entry.size, read: (offset, length) => {
    checkRange(entry.size, offset, length);
    return reader.read(entry.offset + offset, length);
  } };
}
