import { closeSync, openSync, readSync, statSync } from "node:fs";

import { invariant } from "./errors.js";

const CHUNK_HEADER_SIZE = 12;

export interface RwsChunk {
  id: number;
  idHex: string;
  offset: number;
  payloadSizeBytes: number;
  libraryId: number;
}

export interface RwsStream {
  chunks: RwsChunk[];
}

export function readRws(path: string): RwsStream {
  const fileSize = statSync(path).size;
  invariant(fileSize >= CHUNK_HEADER_SIZE, `RWS is too small: ${path}`);
  const descriptor = openSync(path, "r");
  const chunks: RwsChunk[] = [];
  let offset = 0;
  try {
    while (offset < fileSize) {
      invariant(fileSize - offset >= CHUNK_HEADER_SIZE, `RWS has a truncated chunk header at 0x${offset.toString(16)}`);
      const header = Buffer.allocUnsafe(CHUNK_HEADER_SIZE);
      const bytesRead = readSync(descriptor, header, 0, header.length, offset);
      invariant(bytesRead === header.length, `RWS has a truncated chunk header at 0x${offset.toString(16)}`);
      const id = header.readUInt32LE(0);
      const payloadSizeBytes = header.readUInt32LE(4);
      const libraryId = header.readUInt32LE(8);
      invariant(id !== 0, `RWS has an invalid chunk id at 0x${offset.toString(16)}`);
      invariant(
        offset + CHUNK_HEADER_SIZE + payloadSizeBytes <= fileSize,
        `RWS chunk 0x${id.toString(16)} at 0x${offset.toString(16)} exceeds the file`,
      );
      chunks.push({
        id,
        idHex: `0x${id.toString(16).padStart(8, "0")}`,
        offset,
        payloadSizeBytes,
        libraryId,
      });
      offset += CHUNK_HEADER_SIZE + payloadSizeBytes;
    }
  } finally {
    closeSync(descriptor);
  }
  invariant(offset === fileSize, `RWS chunks do not cover the complete file: ${path}`);
  return { chunks };
}
