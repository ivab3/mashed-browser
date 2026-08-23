import {
  closeSync,
  openSync,
  readSync,
  statSync,
  writeSync,
} from "node:fs";

import { ExtractionError, invariant } from "./errors.js";

export const RAW_SECTOR_SIZE = 2352;
export const ISO_SECTOR_SIZE = 2048;
const MODE1_DATA_OFFSET = 16;

export interface IsoExtent {
  logicalBlockAddress: number;
  sizeBytes: number;
  name: string;
}

export class Mode1IsoReader {
  readonly #descriptor: number;
  readonly #dataStartSector: number;
  readonly binPath: string;
  readonly rawSectorCount: number;
  readonly sectorCount: number;
  readonly sizeBytes: number;

  public constructor(binPath: string, dataStartSector = 0) {
    this.binPath = binPath;
    this.#dataStartSector = dataStartSector;
    this.sizeBytes = statSync(binPath).size;
    invariant(
      this.sizeBytes % RAW_SECTOR_SIZE === 0,
      `BIN size ${this.sizeBytes} is not divisible by ${RAW_SECTOR_SIZE}`,
    );
    this.rawSectorCount = this.sizeBytes / RAW_SECTOR_SIZE;
    invariant(
      dataStartSector >= 0 && dataStartSector < this.rawSectorCount,
      `CUE data start sector ${dataStartSector} is outside the BIN`,
    );
    this.sectorCount = this.rawSectorCount - dataStartSector;
    this.#descriptor = openSync(binPath, "r");
  }

  public close(): void {
    closeSync(this.#descriptor);
  }

  public readSector(logicalBlockAddress: number): Buffer {
    if (!Number.isSafeInteger(logicalBlockAddress) || logicalBlockAddress < 0 || logicalBlockAddress >= this.sectorCount) {
      throw new ExtractionError(`ISO sector ${logicalBlockAddress} is outside the MODE1 track`);
    }

    const rawSector = Buffer.allocUnsafe(RAW_SECTOR_SIZE);
    const rawSectorNumber = this.#dataStartSector + logicalBlockAddress;
    const bytesRead = readSync(
      this.#descriptor,
      rawSector,
      0,
      RAW_SECTOR_SIZE,
      rawSectorNumber * RAW_SECTOR_SIZE,
    );
    invariant(bytesRead === RAW_SECTOR_SIZE, `Could not read complete raw sector ${rawSectorNumber}`);
    this.#validateSector(rawSector, rawSectorNumber);
    return rawSector.subarray(MODE1_DATA_OFFSET, MODE1_DATA_OFFSET + ISO_SECTOR_SIZE);
  }

  public readIsoBytes(offset: number, length: number): Buffer {
    invariant(Number.isSafeInteger(offset) && offset >= 0, `Invalid ISO offset: ${offset}`);
    invariant(Number.isSafeInteger(length) && length >= 0, `Invalid ISO length: ${length}`);
    invariant(offset + length <= this.sectorCount * ISO_SECTOR_SIZE, "ISO byte range is outside the MODE1 track");

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

  public copyExtent(extent: IsoExtent, targetPath: string): void {
    invariant(extent.logicalBlockAddress >= 0, `Invalid extent offset for ${extent.name}`);
    invariant(extent.sizeBytes >= 0, `Invalid extent size for ${extent.name}`);
    invariant(
      extent.logicalBlockAddress * ISO_SECTOR_SIZE + extent.sizeBytes <= this.sectorCount * ISO_SECTOR_SIZE,
      `Extent for ${extent.name} is outside the MODE1 track`,
    );

    const output = openSync(targetPath, "wx");
    let logicalBlockAddress = extent.logicalBlockAddress;
    let remaining = extent.sizeBytes;
    try {
      while (remaining > 0) {
        const sector = this.readSector(logicalBlockAddress);
        const bytesToWrite = Math.min(remaining, sector.length);
        writeSync(output, sector, 0, bytesToWrite);
        remaining -= bytesToWrite;
        logicalBlockAddress += 1;
      }
    } finally {
      closeSync(output);
    }
  }

  #validateSector(rawSector: Buffer, rawSectorNumber: number): void {
    if (rawSector[0] !== 0 || rawSector[11] !== 0 || rawSector.subarray(1, 11).some((byte) => byte !== 0xff)) {
      throw new ExtractionError(`Sector ${rawSectorNumber} has an invalid CD-ROM sync header`);
    }
    if (rawSector[15] !== 1) {
      throw new ExtractionError(`Sector ${rawSectorNumber} is not MODE1`);
    }
  }
}
