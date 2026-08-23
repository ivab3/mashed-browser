import { closeSync, mkdirSync, openSync, readSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { ExtractionError, invariant } from "./errors.js";
import { safeRelativePath } from "./paths.js";

const PIZ_SIGNATURE = Buffer.from([0x50, 0x49, 0x5a, 0x00, 0x03, 0x00, 0x00, 0x00]);
const TABLE_OFFSET = 0x800;
const ENTRY_SIZE = 0x80;
const NAME_LENGTH = 0x73;

export interface PizEntry {
  name: string;
  offset: number;
  sizeBytes: number;
  flags: number;
}

export interface PizArchive {
  entryCount: number;
  appendix: "zero" | "cc";
  entries: PizEntry[];
}

function readExactly(descriptor: number, length: number, position: number, context: string): Buffer {
  const buffer = Buffer.allocUnsafe(length);
  const bytesRead = readSync(descriptor, buffer, 0, length, position);
  invariant(bytesRead === length, `${context} is truncated`);
  return buffer;
}

export function readPiz(path: string): PizArchive {
  const sizeBytes = statSync(path).size;
  invariant(sizeBytes >= TABLE_OFFSET, `PIZ is too small: ${path}`);
  const descriptor = openSync(path, "r");
  try {
    const header = readExactly(descriptor, 0x10, 0, "PIZ header");
    invariant(header.subarray(0, PIZ_SIGNATURE.length).equals(PIZ_SIGNATURE), `Invalid PIZ signature: ${path}`);
    const entryCount = header.readUInt32LE(8);
    invariant(entryCount > 0 && entryCount <= 4096, `Invalid PIZ entry count ${entryCount}: ${path}`);
    invariant(TABLE_OFFSET + entryCount * ENTRY_SIZE <= sizeBytes, `PIZ file table exceeds archive: ${path}`);
    const appendixBytes = header.subarray(0x0c, 0x10);
    const appendixValue = appendixBytes[0]!;
    invariant(
      (appendixValue === 0x00 || appendixValue === 0xcc) && appendixBytes.every((byte) => byte === appendixValue),
      `Unsupported PIZ header appendix: ${path}`,
    );

    const entries: PizEntry[] = [];
    const outputNames = new Set<string>();
    for (let index = 0; index < entryCount; index += 1) {
      const record = readExactly(descriptor, ENTRY_SIZE, TABLE_OFFSET + index * ENTRY_SIZE, `PIZ entry ${index}`);
      const zeroIndex = record.subarray(0, NAME_LENGTH).indexOf(0);
      const rawName = record.subarray(0, zeroIndex === -1 ? NAME_LENGTH : zeroIndex).toString("latin1");
      const name = safeRelativePath(rawName, "PIZ entry");
      const normalizedName = name.toLocaleLowerCase("en-US");
      if (outputNames.has(normalizedName)) {
        throw new ExtractionError(`PIZ contains colliding entry names: ${name}`);
      }
      outputNames.add(normalizedName);

      const offset = record.readUInt32LE(0x74);
      const entrySize = record.readUInt32LE(0x78);
      const flags = record.readUInt32LE(0x7c);
      invariant(offset >= TABLE_OFFSET + entryCount * ENTRY_SIZE, `PIZ entry overlaps file table: ${name}`);
      invariant(offset + entrySize <= sizeBytes, `PIZ entry exceeds archive: ${name}`);
      entries.push({ name, offset, sizeBytes: entrySize, flags });
    }
    return { entryCount, appendix: appendixValue === 0xcc ? "cc" : "zero", entries };
  } finally {
    closeSync(descriptor);
  }
}

export function extractPiz(path: string, archive: PizArchive, targetDirectory: string): void {
  const input = openSync(path, "r");
  try {
    for (const entry of archive.entries) {
      const outputPath = join(targetDirectory, ...entry.name.split("/"));
      mkdirSync(dirname(outputPath), { recursive: true });
      const output = openSync(outputPath, "wx");
      let inputOffset = entry.offset;
      let remaining = entry.sizeBytes;
      try {
        const buffer = Buffer.allocUnsafe(64 * 1024);
        while (remaining > 0) {
          const bytesToRead = Math.min(buffer.length, remaining);
          const bytesRead = readSync(input, buffer, 0, bytesToRead, inputOffset);
          invariant(bytesRead === bytesToRead, `PIZ entry is truncated: ${entry.name}`);
          writeSync(output, buffer, 0, bytesRead);
          inputOffset += bytesRead;
          remaining -= bytesRead;
        }
      } finally {
        closeSync(output);
      }
    }
  } finally {
    closeSync(input);
  }
}
