#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const RAW_SECTOR_SIZE = 2352;
const ISO_SECTOR_SIZE = 2048;
const MODE1_DATA_OFFSET = 16;
const PVD_SECTOR = 16;

function usage() {
  return [
    "Usage:",
    "  node tools/reference/inspect-build.mjs --cue /path/to/game.cue",
    "  node tools/reference/inspect-build.mjs --cue /path/to/game.cue --expect reference/build.json",
  ].join("\n");
}

function parseArguments(argv) {
  const result = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--cue" || argument === "--expect") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`Missing value for ${argument}`);
      }
      result[argument.slice(2)] = value;
      index += 1;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!result.cue) {
    throw new Error("--cue is required");
  }

  return result;
}

function parseCue(cuePath) {
  const cue = readFileSync(cuePath, "utf8");
  const fileMatches = [...cue.matchAll(/^\s*FILE\s+"([^"]+)"\s+BINARY\s*$/gim)];
  const trackMatches = [...cue.matchAll(/^\s*TRACK\s+\d+\s+([^\s]+)\s*$/gim)];

  if (fileMatches.length !== 1) {
    throw new Error(`Expected exactly one BINARY file in CUE, found ${fileMatches.length}`);
  }

  if (trackMatches.length !== 1 || trackMatches[0][1].toUpperCase() !== "MODE1/2352") {
    throw new Error("Only a single MODE1/2352 track is supported");
  }

  const binPath = resolve(dirname(cuePath), fileMatches[0][1]);
  if (!existsSync(binPath)) {
    throw new Error(`BIN referenced by CUE does not exist: ${binPath}`);
  }

  return { binPath, trackMode: "MODE1/2352" };
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

class Mode1IsoReader {
  constructor(binPath) {
    this.binPath = binPath;
    this.fileDescriptor = openSync(binPath, "r");
    this.sizeBytes = statSync(binPath).size;

    if (this.sizeBytes % RAW_SECTOR_SIZE !== 0) {
      throw new Error(`BIN size ${this.sizeBytes} is not divisible by ${RAW_SECTOR_SIZE}`);
    }

    this.sectorCount = this.sizeBytes / RAW_SECTOR_SIZE;
  }

  close() {
    closeSync(this.fileDescriptor);
  }

  readSector(logicalBlockAddress) {
    if (logicalBlockAddress < 0 || logicalBlockAddress >= this.sectorCount) {
      throw new Error(`ISO sector ${logicalBlockAddress} is outside the BIN`);
    }

    const rawSector = Buffer.allocUnsafe(RAW_SECTOR_SIZE);
    const bytesRead = readSync(
      this.fileDescriptor,
      rawSector,
      0,
      RAW_SECTOR_SIZE,
      logicalBlockAddress * RAW_SECTOR_SIZE,
    );

    if (bytesRead !== RAW_SECTOR_SIZE) {
      throw new Error(`Could not read complete raw sector ${logicalBlockAddress}`);
    }

    const expectedSync = [0x00, ...Array(10).fill(0xff), 0x00];
    for (let index = 0; index < expectedSync.length; index += 1) {
      if (rawSector[index] !== expectedSync[index]) {
        throw new Error(`Sector ${logicalBlockAddress} has an invalid CD-ROM sync header`);
      }
    }

    if (rawSector[15] !== 1) {
      throw new Error(`Sector ${logicalBlockAddress} is not MODE1`);
    }

    return rawSector.subarray(MODE1_DATA_OFFSET, MODE1_DATA_OFFSET + ISO_SECTOR_SIZE);
  }

  readIsoBytes(offset, length) {
    const result = Buffer.allocUnsafe(length);
    let sourceOffset = offset;
    let targetOffset = 0;

    while (targetOffset < length) {
      const sectorNumber = Math.floor(sourceOffset / ISO_SECTOR_SIZE);
      const offsetInSector = sourceOffset % ISO_SECTOR_SIZE;
      const bytesToCopy = Math.min(length - targetOffset, ISO_SECTOR_SIZE - offsetInSector);
      const sector = this.readSector(sectorNumber);
      sector.copy(result, targetOffset, offsetInSector, offsetInSector + bytesToCopy);
      sourceOffset += bytesToCopy;
      targetOffset += bytesToCopy;
    }

    return result;
  }

  copyExtent(extent, targetPath) {
    const output = openSync(targetPath, "w");
    const sectorsPerBatch = 256;
    let logicalBlockAddress = extent.logicalBlockAddress;
    let remaining = extent.sizeBytes;

    try {
      while (remaining > 0) {
        const batchSectors = Math.min(sectorsPerBatch, Math.ceil(remaining / ISO_SECTOR_SIZE));
        const rawBatch = Buffer.allocUnsafe(batchSectors * RAW_SECTOR_SIZE);
        const bytesRead = readSync(
          this.fileDescriptor,
          rawBatch,
          0,
          rawBatch.length,
          logicalBlockAddress * RAW_SECTOR_SIZE,
        );

        if (bytesRead !== rawBatch.length) {
          throw new Error(`Could not read ISO extent for ${extent.name}`);
        }

        const dataBatch = Buffer.allocUnsafe(batchSectors * ISO_SECTOR_SIZE);
        for (let sectorIndex = 0; sectorIndex < batchSectors; sectorIndex += 1) {
          const rawOffset = sectorIndex * RAW_SECTOR_SIZE;
          const mode = rawBatch[rawOffset + 15];
          if (mode !== 1) {
            throw new Error(`Extent for ${extent.name} contains a non-MODE1 sector`);
          }
          rawBatch.copy(
            dataBatch,
            sectorIndex * ISO_SECTOR_SIZE,
            rawOffset + MODE1_DATA_OFFSET,
            rawOffset + MODE1_DATA_OFFSET + ISO_SECTOR_SIZE,
          );
        }

        const bytesToWrite = Math.min(remaining, dataBatch.length);
        writeSync(output, dataBatch, 0, bytesToWrite);
        remaining -= bytesToWrite;
        logicalBlockAddress += batchSectors;
      }
    } finally {
      closeSync(output);
    }
  }
}

function parseDirectoryRecord(record) {
  if (record.length < 34) {
    throw new Error("Invalid ISO 9660 directory record");
  }

  const nameLength = record[32];
  const rawName = record.subarray(33, 33 + nameLength);
  let name;

  if (nameLength === 1 && rawName[0] === 0) {
    name = ".";
  } else if (nameLength === 1 && rawName[0] === 1) {
    name = "..";
  } else {
    name = rawName.toString("ascii").replace(/;\d+$/, "");
  }

  return {
    name,
    logicalBlockAddress: record.readUInt32LE(2),
    sizeBytes: record.readUInt32LE(10),
    isDirectory: Boolean(record[25] & 2),
  };
}

function readIsoMetadata(reader) {
  const primaryVolumeDescriptor = reader.readSector(PVD_SECTOR);
  if (
    primaryVolumeDescriptor[0] !== 1 ||
    primaryVolumeDescriptor.subarray(1, 6).toString("ascii") !== "CD001" ||
    primaryVolumeDescriptor[6] !== 1
  ) {
    throw new Error("Primary volume descriptor is not ISO 9660 version 1");
  }

  const logicalBlockSize = primaryVolumeDescriptor.readUInt16LE(128);
  if (logicalBlockSize !== ISO_SECTOR_SIZE) {
    throw new Error(`Unsupported ISO logical block size: ${logicalBlockSize}`);
  }

  const rootRecordLength = primaryVolumeDescriptor[156];
  const root = parseDirectoryRecord(primaryVolumeDescriptor.subarray(156, 156 + rootRecordLength));
  const directory = reader.readIsoBytes(
    root.logicalBlockAddress * ISO_SECTOR_SIZE,
    root.sizeBytes,
  );
  const entries = new Map();

  for (let offset = 0; offset < directory.length; ) {
    const recordLength = directory[offset];
    if (recordLength === 0) {
      offset = (Math.floor(offset / ISO_SECTOR_SIZE) + 1) * ISO_SECTOR_SIZE;
      continue;
    }

    const entry = parseDirectoryRecord(directory.subarray(offset, offset + recordLength));
    entries.set(entry.name.toUpperCase(), entry);
    offset += recordLength;
  }

  return {
    volumeId: primaryVolumeDescriptor.subarray(40, 72).toString("ascii").trim(),
    logicalBlockSize,
    entries,
  };
}

function requireEntry(entries, name) {
  const entry = entries.get(name);
  if (!entry || entry.isDirectory) {
    throw new Error(`Required installer file is missing from ISO root: ${name}`);
  }
  return entry;
}

function inspectPe(path) {
  const header = Buffer.alloc(4096);
  const descriptor = openSync(path, "r");
  const bytesRead = readSync(descriptor, header, 0, header.length, 0);
  closeSync(descriptor);

  if (bytesRead < 256 || header.subarray(0, 2).toString("ascii") !== "MZ") {
    throw new Error("Extracted MFL.exe does not have an MZ header");
  }

  const peOffset = header.readUInt32LE(0x3c);
  if (header.subarray(peOffset, peOffset + 4).toString("binary") !== "PE\0\0") {
    throw new Error("Extracted MFL.exe does not have a PE header");
  }

  const machine = header.readUInt16LE(peOffset + 4);
  const optionalHeaderMagic = header.readUInt16LE(peOffset + 24);
  if (machine !== 0x014c || optionalHeaderMagic !== 0x010b) {
    throw new Error(
      `Expected a PE32 Intel 80386 executable, got machine 0x${machine.toString(16)}`,
    );
  }

  return { format: "PE32", machine: "Intel 80386" };
}

async function inspectBuild(cuePath) {
  const absoluteCuePath = resolve(cuePath);
  const { binPath, trackMode } = parseCue(absoluteCuePath);
  const reader = new Mode1IsoReader(binPath);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "mashed-reference-"));

  try {
    const iso = readIsoMetadata(reader);
    const installerFiles = ["DATA1.CAB", "DATA1.HDR", "DATA2.CAB"];

    for (const name of installerFiles) {
      const entry = requireEntry(iso.entries, name);
      reader.copyExtent(entry, join(temporaryDirectory, name.toLowerCase()));
    }

    const extractionDirectory = join(temporaryDirectory, "extracted");
    mkdirSync(extractionDirectory);
    const extraction = spawnSync(
      "unshield",
      [
        "-d",
        extractionDirectory,
        "-j",
        "x",
        join(temporaryDirectory, "data1.cab"),
        "MFL.exe",
      ],
      { encoding: "utf8" },
    );

    if (extraction.error?.code === "ENOENT") {
      throw new Error("unshield is required but was not found in PATH");
    }
    if (extraction.status !== 0) {
      throw new Error(`unshield failed:\n${extraction.stderr || extraction.stdout}`);
    }

    const executablePath = join(extractionDirectory, "App_Executables", "MFL.exe");
    if (!existsSync(executablePath)) {
      throw new Error("unshield completed but MFL.exe was not extracted");
    }

    const [cueHash, binHash, executableHash] = await Promise.all([
      sha256(absoluteCuePath),
      sha256(binPath),
      sha256(executablePath),
    ]);
    const pe = inspectPe(executablePath);

    return {
      schemaVersion: 1,
      game: {
        title: "Mashed: Fully Loaded",
        edition: "Europe (En,Fr,De,Es,It)",
        languages: ["English", "French", "German", "Spanish", "Italian"],
      },
      discImage: {
        cue: {
          fileName: basename(absoluteCuePath),
          sizeBytes: statSync(absoluteCuePath).size,
          sha256: cueHash,
        },
        bin: {
          fileName: basename(binPath),
          sizeBytes: reader.sizeBytes,
          sha256: binHash,
        },
        trackMode,
        sectorCount: reader.sectorCount,
        iso9660: {
          volumeId: iso.volumeId,
          logicalBlockSize: iso.logicalBlockSize,
        },
      },
      executable: {
        installerPath: "App Executables/MFL.exe",
        sizeBytes: statSync(executablePath).size,
        sha256: executableHash,
        ...pe,
      },
    };
  } finally {
    reader.close();
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const actual = await inspectBuild(options.cue);

  if (!options.expect) {
    process.stdout.write(stableJson(actual));
    return;
  }

  const expectedPath = resolve(options.expect);
  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  if (stableJson(actual) !== stableJson(expected)) {
    console.error("Build metadata does not match the reference.");
    console.error("Expected:");
    console.error(stableJson(expected));
    console.error("Actual:");
    console.error(stableJson(actual));
    process.exitCode = 1;
    return;
  }

  console.log(`Verified ${basename(options.cue)} against ${options.expect}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage());
  process.exitCode = 1;
});
