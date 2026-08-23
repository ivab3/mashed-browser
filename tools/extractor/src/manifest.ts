import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { ExtractionError, invariant } from "./errors.js";

export const MANIFEST_SCHEMA_VERSION = 1;

export type AssetKind =
  | "archive-piz"
  | "audio-rws"
  | "binary"
  | "data"
  | "executable"
  | "image"
  | "library"
  | "model-dff"
  | "script-lua"
  | "texture-txd"
  | "video-mpeg"
  | "world-bsp";

export interface DiscImageSource {
  kind: "disc-image";
  cue: { fileName: string; sizeBytes: number; sha256: string };
  bin: { fileName: string; sizeBytes: number; sha256: string };
  trackMode: "MODE1/2352";
  dataStartSector: number;
  sectorCount: number;
  iso9660: { volumeId: string; logicalBlockSize: number };
}

export interface InstalledDirectorySource {
  kind: "installed-directory";
  directoryName: string;
  ignoredRuntimeFiles: string[];
}

export type ManifestSource = DiscImageSource | InstalledDirectorySource;

export type FileOrigin =
  | { kind: "installshield"; sourcePath: string }
  | { kind: "installed-directory"; sourcePath: string }
  | {
      kind: "piz-entry";
      archivePath: string;
      entryName: string;
      offset: number;
      flags: number;
    };

export interface PizMetadata {
  kind: "piz";
  entryCount: number;
  appendix: "zero" | "cc";
}

export interface RwsMetadata {
  kind: "rws";
  chunks: Array<{
    id: number;
    idHex: string;
    offset: number;
    payloadSizeBytes: number;
    libraryId: number;
  }>;
}

export interface ManifestFile {
  path: string;
  type: AssetKind;
  sizeBytes: number;
  sha256: string;
  origin: FileOrigin;
  container?: PizMetadata | RwsMetadata;
}

export type RequiredAsset = "executable" | "luaScript" | "sound" | "video" | "warzone" | "wildfire";

export interface AssetRequirement {
  found: boolean;
  path?: string;
}

export interface AssetManifest {
  schemaVersion: 1;
  tool: { name: "@mashed/extractor"; version: string };
  source: ManifestSource;
  files: ManifestFile[];
  summary: {
    fileCount: number;
    totalSizeBytes: number;
    byType: Partial<Record<AssetKind, number>>;
    required: Record<RequiredAsset, AssetRequirement>;
  };
}

export function classifyFile(path: string): AssetKind {
  switch (extname(path).toLocaleLowerCase("en-US")) {
    case ".piz":
      return "archive-piz";
    case ".rws":
      return "audio-rws";
    case ".exe":
      return "executable";
    case ".dll":
    case ".ocx":
      return "library";
    case ".lua":
      return "script-lua";
    case ".mpg":
    case ".mpeg":
      return "video-mpeg";
    case ".dff":
      return "model-dff";
    case ".txd":
      return "texture-txd";
    case ".bsp":
      return "world-bsp";
    case ".bmp":
    case ".png":
      return "image";
    case ".bin":
      return "binary";
    default:
      return "data";
  }
}

function firstPath(files: ManifestFile[], predicate: (file: ManifestFile) => boolean): string | undefined {
  return files.find(predicate)?.path;
}

function requirement(path: string | undefined): AssetRequirement {
  return path === undefined ? { found: false } : { found: true, path };
}

export function buildSummary(files: ManifestFile[]): AssetManifest["summary"] {
  const byType: Partial<Record<AssetKind, number>> = {};
  let totalSizeBytes = 0;
  for (const file of files) {
    byType[file.type] = (byType[file.type] ?? 0) + 1;
    totalSizeBytes += file.sizeBytes;
  }

  const lowerPath = (file: ManifestFile): string => file.path.toLocaleLowerCase("en-US");
  return {
    fileCount: files.length,
    totalSizeBytes,
    byType,
    required: {
      executable: requirement(firstPath(files, (file) => lowerPath(file).endsWith("/mfl.exe"))),
      wildfire: requirement(
        firstPath(files, (file) => lowerPath(file).endsWith("/toastart/vehicles/wildfire.piz")),
      ),
      warzone: requirement(
        firstPath(files, (file) => lowerPath(file).endsWith("/toastart/tracks/warzone.piz")),
      ),
      luaScript: requirement(firstPath(files, (file) => file.type === "script-lua")),
      sound: requirement(firstPath(files, (file) => file.type === "audio-rws")),
      video: requirement(firstPath(files, (file) => file.type === "video-mpeg")),
    },
  };
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function readManifest(path: string): AssetManifest {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ExtractionError(`Could not read manifest ${path}`, { cause: error });
  }
  invariant(typeof value === "object" && value !== null, "Manifest must be a JSON object");
  const candidate = value as Partial<AssetManifest>;
  invariant(candidate.schemaVersion === MANIFEST_SCHEMA_VERSION, `Unsupported manifest schema: ${String(candidate.schemaVersion)}`);
  invariant(Array.isArray(candidate.files), "Manifest files must be an array");
  invariant(candidate.summary?.fileCount === candidate.files.length, "Manifest fileCount does not match files array");
  return candidate as AssetManifest;
}
