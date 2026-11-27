// InstallShield v6 layout follows unshield's format research. See public/licenses/unshield.txt.
import { md5 } from "@noble/hashes/legacy.js";
import { safeImportPath } from "./browser-import.js";
import { checkRange, requireDisc, type CheckImport, type RandomAccessData } from "./disc-reader.js";

export interface CabinetFile {
  index: number; path: string; flags: number; expanded: number; compressed: number;
  offset: number; md5: Uint8Array; volume: number; links: number;
}
function u64(view: DataView, offset: number): number {
  const value = Number(view.getBigUint64(offset, true));
  requireDisc(Number.isSafeInteger(value), "InstallShield offset/size exceeds safe integer range");
  return value;
}
function version(view: DataView): number {
  requireDisc(view.byteLength >= 20 && view.getUint32(0, true) === 0x28635349, "Not an InstallShield cabinet header");
  const encoded = view.getUint32(4, true);
  requireDisc([1, 2, 4].includes(encoded >>> 24), "Unsupported InstallShield version encoding");
  const major = encoded >>> 24 === 1 ? (encoded >>> 12) & 15 : Math.floor((encoded & 0xffff) / 100);
  requireDisc(major === 6, `Unsupported InstallShield version ${major}; expected version 6`);
  return encoded;
}

export function readInstallShieldHeader(bytes: Uint8Array): { version: number; files: CabinetFile[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const encoded = version(view);
  const descriptor = view.getUint32(12, true);
  const descriptorSize = view.getUint32(16, true);
  requireDisc(descriptor >= 20 && descriptorSize >= 0x30, "Invalid InstallShield descriptor");
  checkRange(bytes.length, descriptor, descriptorSize);
  const table = descriptor + view.getUint32(descriptor + 0xc, true);
  const tableSize = view.getUint32(descriptor + 0x14, true);
  requireDisc(tableSize === view.getUint32(descriptor + 0x18, true), "InstallShield file table size mismatch");
  checkRange(bytes.length, table, tableSize);
  const directories = view.getUint32(descriptor + 0x1c, true);
  const count = view.getUint32(descriptor + 0x28, true);
  const records = table + view.getUint32(descriptor + 0x2c, true);
  requireDisc(directories > 0 && directories <= 4096 && count > 0 && count <= 10000, "Invalid InstallShield file/directory counts");
  checkRange(tableSize, 0, directories * 4);
  checkRange(tableSize, records - table, count * 0x57);
  requireDisc(records >= table + directories * 4, "InstallShield file records overlap directory table");
  const string = (offset: number): string => {
    checkRange(tableSize, offset, 1);
    const start = table + offset;
    let end = start;
    while (end < table + tableSize && end - start <= 4096 && bytes[end] !== 0) end++;
    requireDisc(end < table + tableSize && end - start <= 4096, "Unterminated InstallShield name");
    return String.fromCharCode(...bytes.subarray(start, end));
  };
  const paths = Array.from({ length: directories }, (_, index) => string(view.getUint32(table + index * 4, true)));
  const files: CabinetFile[] = [];
  for (let index = 0; index < count; index++) {
    const p = records + index * 0x57;
    const flags = view.getUint16(p, true);
    if (flags & 8) continue; // Installer-only invalid/external placeholders have no payload.
    const directory = view.getUint16(p + 0x3e, true);
    requireDisc(directory < paths.length, "Invalid InstallShield directory index");
    const name = string(view.getUint32(p + 0x3a, true));
    const path = `${paths[directory] ? `${paths[directory]}/` : ""}${name}`.replaceAll("\\", "/").toLowerCase();
    files.push({ index, path, flags, expanded: u64(view, p + 2), compressed: u64(view, p + 10),
      offset: u64(view, p + 18), md5: bytes.slice(p + 26, p + 42),
      volume: view.getUint16(p + 85, true), links: bytes[p + 84]! });
  }
  return { version: encoded, files };
}

async function inflateBlock(bytes: Uint8Array<ArrayBuffer>, limit: number, check: CheckImport): Promise<Uint8Array<ArrayBuffer>> {
  let stream: DecompressionStream;
  try { stream = new DecompressionStream("deflate-raw"); }
  catch { throw new Error("This browser does not support raw DEFLATE decompression. Import an installed game folder instead."); }
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const output = new Uint8Array(limit);
  let length = 0;
  try {
    while (true) {
      check();
      const item = await reader.read();
      if (item.done) break;
      requireDisc(length + item.value.length <= limit, "InstallShield block exceeds its decompression budget");
      output.set(item.value, length);
      length += item.value.length;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  requireDisc(length > 0, "Empty InstallShield compressed block");
  return output.slice(0, length);
}

export async function extractCabinetFile(
  file: CabinetFile, cabinet: RandomAccessData, encodedVersion: number,
  check: CheckImport = () => {}, progress: (bytes: number) => void = () => {},
): Promise<Blob> {
  safeImportPath(file.path);
  requireDisc(file.links === 0 && (file.flags === 0 || file.flags === 4),
    `${file.path}: split, linked or obfuscated InstallShield payloads are unsupported`);
  requireDisc(file.expanded > 0 && file.expanded <= 64 * 1024 * 1024 && file.compressed > 0 && file.compressed <= 64 * 1024 * 1024,
    `${file.path}: InstallShield file exceeds the 64 MiB import budget`);
  const header = await cabinet.read(0, 84);
  const view = new DataView(header.buffer);
  requireDisc(version(view) === encodedVersion, "InstallShield cabinet/header version mismatch");
  const dataStart = u64(view, 20);
  requireDisc(file.index >= view.getUint32(28, true) && file.index <= view.getUint32(32, true),
    `${file.path}: wrong InstallShield volume`);
  requireDisc(dataStart >= 84 && file.offset >= dataStart, "InstallShield payload overlaps volume header");
  const storedSize = file.flags & 4 ? file.compressed : file.expanded;
  checkRange(cabinet.size, file.offset, storedSize);
  requireDisc(file.flags !== 0 || file.compressed === file.expanded, "Invalid uncompressed InstallShield size");
  const compressed = await cabinet.read(file.offset, storedSize);
  check();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const digest = md5.create();
  let written = 0;
  for (let position = 0; position < compressed.length;) {
    check();
    let output: Uint8Array<ArrayBuffer>;
    if (file.flags & 4) {
      requireDisc(position + 2 <= compressed.length, "Truncated InstallShield block length");
      const length = compressed[position]! | compressed[position + 1]! << 8;
      position += 2;
      requireDisc(length > 0 && position + length <= compressed.length, "Invalid InstallShield compressed block bounds");
      output = await inflateBlock(compressed.slice(position, position + length), Math.min(65536, file.expanded - written), check);
      position += length;
    } else {
      output = compressed.slice(position, Math.min(position + 65536, compressed.length));
      position += output.length;
    }
    written += output.length;
    requireDisc(written <= file.expanded, "InstallShield payload exceeds declared size");
    digest.update(output);
    parts.push(output);
    progress(written);
  }
  requireDisc(written === file.expanded, `${file.path}: InstallShield expanded size mismatch`);
  requireDisc(digest.digest().every((byte, index) => byte === file.md5[index]), `${file.path}: InstallShield MD5 checksum mismatch`);
  check();
  return new Blob(parts);
}
