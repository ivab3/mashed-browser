import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { invariant } from "./errors.js";
import { ISO_SECTOR_SIZE, type IsoExtent, Mode1IsoReader } from "./mode1.js";
import { safeRelativePath } from "./paths.js";

const PVD_SECTOR = 16;

export interface IsoEntry extends IsoExtent {
  path: string;
  isDirectory: boolean;
}

export interface IsoVolume {
  volumeId: string;
  logicalBlockSize: number;
  entries: IsoEntry[];
}

interface DirectoryRecord extends IsoExtent {
  isDirectory: boolean;
}

function parseDirectoryRecord(record: Buffer): DirectoryRecord {
  invariant(record.length >= 34, "Invalid ISO 9660 directory record");
  const nameLength = record[32]!;
  invariant(33 + nameLength <= record.length, "ISO 9660 directory name exceeds its record");
  const rawName = record.subarray(33, 33 + nameLength);
  let name: string;
  if (nameLength === 1 && rawName[0] === 0) {
    name = ".";
  } else if (nameLength === 1 && rawName[0] === 1) {
    name = "..";
  } else {
    name = rawName.toString("ascii").replace(/;\d+$/, "");
  }

  const logicalBlockAddress = record.readUInt32LE(2);
  const logicalBlockAddressBe = record.readUInt32BE(6);
  const sizeBytes = record.readUInt32LE(10);
  const sizeBytesBe = record.readUInt32BE(14);
  invariant(logicalBlockAddress === logicalBlockAddressBe, `ISO extent byte-order mismatch for ${name}`);
  invariant(sizeBytes === sizeBytesBe, `ISO size byte-order mismatch for ${name}`);

  return {
    name,
    logicalBlockAddress,
    sizeBytes,
    isDirectory: Boolean(record[25]! & 2),
  };
}

function readDirectory(reader: Mode1IsoReader, directory: DirectoryRecord): DirectoryRecord[] {
  const data = reader.readIsoBytes(directory.logicalBlockAddress * ISO_SECTOR_SIZE, directory.sizeBytes);
  const entries: DirectoryRecord[] = [];
  for (let offset = 0; offset < data.length; ) {
    const recordLength = data[offset]!;
    if (recordLength === 0) {
      offset = (Math.floor(offset / ISO_SECTOR_SIZE) + 1) * ISO_SECTOR_SIZE;
      continue;
    }
    invariant(offset + recordLength <= data.length, "ISO directory record exceeds directory extent");
    const entry = parseDirectoryRecord(data.subarray(offset, offset + recordLength));
    if (entry.name !== "." && entry.name !== "..") {
      entries.push(entry);
    }
    offset += recordLength;
  }
  return entries;
}

export function readIsoVolume(reader: Mode1IsoReader): IsoVolume {
  const descriptor = reader.readSector(PVD_SECTOR);
  invariant(
    descriptor[0] === 1 && descriptor.subarray(1, 6).toString("ascii") === "CD001" && descriptor[6] === 1,
    "Primary volume descriptor is not ISO 9660 version 1",
  );
  const logicalBlockSize = descriptor.readUInt16LE(128);
  invariant(logicalBlockSize === ISO_SECTOR_SIZE, `Unsupported ISO logical block size: ${logicalBlockSize}`);
  invariant(descriptor.readUInt16BE(130) === logicalBlockSize, "ISO logical block byte-order mismatch");

  const rootRecordLength = descriptor[156]!;
  const root = parseDirectoryRecord(descriptor.subarray(156, 156 + rootRecordLength));
  const entries: IsoEntry[] = [];
  const visit = (directory: DirectoryRecord, parentPath: string): void => {
    for (const entry of readDirectory(reader, directory)) {
      const path = safeRelativePath(parentPath ? `${parentPath}/${entry.name}` : entry.name, "ISO 9660");
      entries.push({ ...entry, path });
      if (entry.isDirectory) {
        visit(entry, path);
      }
    }
  };
  visit(root, "");

  return {
    volumeId: descriptor.subarray(40, 72).toString("ascii").trim(),
    logicalBlockSize,
    entries,
  };
}

export function extractIsoFiles(reader: Mode1IsoReader, volume: IsoVolume, targetDirectory: string): void {
  for (const entry of volume.entries) {
    const targetPath = join(targetDirectory, ...entry.path.split("/"));
    if (entry.isDirectory) {
      mkdirSync(targetPath, { recursive: true });
      continue;
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    reader.copyExtent(entry, targetPath);
  }
}
