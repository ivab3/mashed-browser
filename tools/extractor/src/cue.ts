import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { ExtractionError, invariant } from "./errors.js";

const FRAMES_PER_SECOND = 75;

export interface CueTrack {
  binPath: string;
  dataStartSector: number;
  trackMode: "MODE1/2352";
}

function parseMsf(value: string): number {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(value);
  invariant(match, `Invalid CUE timestamp: ${value}`);

  const minutes = Number.parseInt(match[1]!, 10);
  const seconds = Number.parseInt(match[2]!, 10);
  const frames = Number.parseInt(match[3]!, 10);
  invariant(seconds < 60 && frames < FRAMES_PER_SECOND, `Invalid CUE timestamp: ${value}`);
  return (minutes * 60 + seconds) * FRAMES_PER_SECOND + frames;
}

export function parseCue(cuePath: string): CueTrack {
  const absoluteCuePath = resolve(cuePath);
  const contents = readFileSync(absoluteCuePath, "utf8");
  const files = [...contents.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+BINARY\s*$/gim)];
  const tracks = [...contents.matchAll(/^\s*TRACK\s+(\d+)\s+(\S+)\s*$/gim)];
  const indexes = [...contents.matchAll(/^\s*INDEX\s+01\s+(\d{1,3}:\d{2}:\d{2})\s*$/gim)];

  invariant(files.length === 1, `Expected one BINARY file in CUE, found ${files.length}`);
  invariant(tracks.length === 1, `Expected one track in CUE, found ${tracks.length}`);
  invariant(tracks[0]![2]!.toUpperCase() === "MODE1/2352", "Only MODE1/2352 CUE tracks are supported");
  invariant(indexes.length === 1, `Expected one INDEX 01 in CUE, found ${indexes.length}`);

  const referencedFile = files[0]![1] ?? files[0]![2];
  invariant(referencedFile, "CUE BINARY file name is empty");
  const binPath = resolve(dirname(absoluteCuePath), referencedFile);
  if (!existsSync(binPath)) {
    throw new ExtractionError(`BIN referenced by CUE does not exist: ${binPath}`);
  }

  return {
    binPath,
    dataStartSector: parseMsf(indexes[0]![1]!),
    trackMode: "MODE1/2352",
  };
}
