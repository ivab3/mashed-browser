import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { parseCue } from "./cue.js";
import { ExtractionError, invariant } from "./errors.js";
import { sha256 } from "./hash.js";
import { extractIsoFiles, readIsoVolume } from "./iso9660.js";
import {
  buildSummary,
  classifyFile,
  MANIFEST_SCHEMA_VERSION,
  stableJson,
  type AssetManifest,
  type FileOrigin,
  type ManifestFile,
  type ManifestSource,
} from "./manifest.js";
import { Mode1IsoReader } from "./mode1.js";
import { isInside, toManifestPath } from "./paths.js";
import { extractPiz, readPiz } from "./piz.js";
import { readRws } from "./rws.js";
import {
  copyGameFiles,
  DEFAULT_RUNTIME_EXCLUSIONS,
  findGameRoot,
  listFiles,
} from "./source.js";

const OUTPUT_MARKER = ".mashed-extractor-output";
const TOOL_VERSION = "0.1.0";

export interface ExtractOptions {
  source: string;
  out: string;
}

interface PreparedSource {
  source: ManifestSource;
  gameRoot: string;
  cleanup?: () => void;
}

async function prepareDiscImage(cuePath: string): Promise<PreparedSource> {
  const absoluteCuePath = resolve(cuePath);
  const cue = parseCue(absoluteCuePath);
  const reader = new Mode1IsoReader(cue.binPath, cue.dataStartSector);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "mashed-extractor-disc-"));
  try {
    const volume = readIsoVolume(reader);
    const isoRoot = join(temporaryDirectory, "iso");
    mkdirSync(isoRoot);
    extractIsoFiles(reader, volume, isoRoot);

    const cab = listFiles(isoRoot).find(
      (file) => basename(file.absolutePath).toLocaleLowerCase("en-US") === "data1.cab",
    );
    invariant(cab, "InstallShield DATA1.CAB is missing from the ISO 9660 filesystem");
    const extractedRoot = join(temporaryDirectory, "installshield");
    mkdirSync(extractedRoot);
    const extraction = spawnSync(
      "unshield",
      ["-d", extractedRoot, "x", cab.absolutePath],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    if (extraction.error && "code" in extraction.error && extraction.error.code === "ENOENT") {
      throw new ExtractionError("unshield is required for disc-image extraction but was not found in PATH");
    }
    if (extraction.status !== 0) {
      throw new ExtractionError(`unshield failed:\n${extraction.stderr || extraction.stdout}`);
    }

    const gameRoot = findGameRoot(extractedRoot);
    const [cueHash, binHash] = await Promise.all([sha256(absoluteCuePath), sha256(cue.binPath)]);
    return {
      source: {
        kind: "disc-image",
        cue: {
          fileName: basename(absoluteCuePath),
          sizeBytes: statSync(absoluteCuePath).size,
          sha256: cueHash,
        },
        bin: {
          fileName: basename(cue.binPath),
          sizeBytes: reader.sizeBytes,
          sha256: binHash,
        },
        trackMode: cue.trackMode,
        dataStartSector: cue.dataStartSector,
        sectorCount: reader.sectorCount,
        iso9660: {
          volumeId: volume.volumeId,
          logicalBlockSize: volume.logicalBlockSize,
        },
      },
      gameRoot,
      cleanup: () => rmSync(temporaryDirectory, { force: true, recursive: true }),
    };
  } catch (error) {
    rmSync(temporaryDirectory, { force: true, recursive: true });
    throw error;
  } finally {
    reader.close();
  }
}

function prepareInstalledDirectory(sourcePath: string): PreparedSource {
  const gameRoot = findGameRoot(sourcePath);
  return {
    source: {
      kind: "installed-directory",
      directoryName: basename(gameRoot),
      ignoredRuntimeFiles: [...DEFAULT_RUNTIME_EXCLUSIONS],
    },
    gameRoot,
  };
}

async function prepareSource(sourcePath: string): Promise<PreparedSource> {
  const absoluteSource = resolve(sourcePath);
  invariant(existsSync(absoluteSource), `Source does not exist: ${absoluteSource}`);
  const stats = statSync(absoluteSource);
  if (stats.isDirectory()) {
    return prepareInstalledDirectory(absoluteSource);
  }
  if (stats.isFile() && extname(absoluteSource).toLocaleLowerCase("en-US") === ".cue") {
    return prepareDiscImage(absoluteSource);
  }
  throw new ExtractionError("Source must be an installed directory or a .cue file");
}

function validateReplaceableOutput(outputPath: string): void {
  if (!existsSync(outputPath)) {
    return;
  }
  const markerPath = join(outputPath, OUTPUT_MARKER);
  if (!existsSync(markerPath) || readFileSync(markerPath, "utf8").trim() !== "@mashed/extractor") {
    throw new ExtractionError(
      `Refusing to replace ${outputPath}: it was not created by @mashed/extractor`,
    );
  }
}

async function buildFiles(
  stagingPath: string,
  prepared: PreparedSource,
): Promise<ManifestFile[]> {
  const filesRoot = join(stagingPath, "files");
  mkdirSync(filesRoot);
  const copiedFiles = copyGameFiles(
    prepared.gameRoot,
    filesRoot,
    prepared.source.kind === "installed-directory",
  );
  const originalOriginKind = prepared.source.kind === "disc-image" ? "installshield" : "installed-directory";
  const origins = new Map<string, FileOrigin>();
  for (const file of copiedFiles) {
    origins.set(`files/${file.relativePath}`, {
      kind: originalOriginKind,
      sourcePath: file.relativePath,
    });
  }

  const pizMetadata = new Map<string, ReturnType<typeof readPiz>>();
  for (const file of copiedFiles) {
    if (extname(file.relativePath).toLocaleLowerCase("en-US") !== ".piz") {
      continue;
    }
    const archivePath = `files/${file.relativePath}`;
    const copiedArchivePath = join(filesRoot, ...file.relativePath.split("/"));
    const archive = readPiz(copiedArchivePath);
    pizMetadata.set(archivePath, archive);
    const archiveWithoutExtension = file.relativePath.slice(0, -extname(file.relativePath).length);
    const targetDirectory = join(stagingPath, "expanded", "piz", ...archiveWithoutExtension.split("/"));
    mkdirSync(targetDirectory, { recursive: true });
    extractPiz(copiedArchivePath, archive, targetDirectory);
    for (const entry of archive.entries) {
      const outputPath = `expanded/piz/${archiveWithoutExtension}/${entry.name}`;
      origins.set(outputPath, {
        kind: "piz-entry",
        archivePath,
        entryName: entry.name,
        offset: entry.offset,
        flags: entry.flags,
      });
    }
  }

  const manifestFiles: ManifestFile[] = [];
  for (const file of listFiles(stagingPath)) {
    if (file.relativePath === OUTPUT_MARKER || file.relativePath === "manifest.json") {
      continue;
    }
    const origin = origins.get(file.relativePath);
    invariant(origin, `Missing origin metadata for ${file.relativePath}`);
    const type = classifyFile(file.relativePath);
    const manifestFile: ManifestFile = {
      path: file.relativePath,
      type,
      sizeBytes: statSync(file.absolutePath).size,
      sha256: await sha256(file.absolutePath),
      origin,
    };
    if (type === "archive-piz") {
      const archive = pizMetadata.get(file.relativePath);
      invariant(archive, `Missing PIZ metadata for ${file.relativePath}`);
      manifestFile.container = {
        kind: "piz",
        entryCount: archive.entryCount,
        appendix: archive.appendix,
      };
    } else if (type === "audio-rws") {
      manifestFile.container = { kind: "rws", chunks: readRws(file.absolutePath).chunks };
    }
    manifestFiles.push(manifestFile);
  }
  manifestFiles.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return manifestFiles;
}

function commitOutput(stagingPath: string, outputPath: string): void {
  validateReplaceableOutput(outputPath);
  if (!existsSync(outputPath)) {
    renameSync(stagingPath, outputPath);
    return;
  }

  const backupPath = `${outputPath}.previous-${process.pid}`;
  rmSync(backupPath, { force: true, recursive: true });
  renameSync(outputPath, backupPath);
  try {
    renameSync(stagingPath, outputPath);
    rmSync(backupPath, { force: true, recursive: true });
  } catch (error) {
    if (!existsSync(outputPath) && existsSync(backupPath)) {
      renameSync(backupPath, outputPath);
    }
    throw error;
  }
}

export async function extractAssets(options: ExtractOptions): Promise<AssetManifest> {
  const sourcePath = resolve(options.source);
  const outputPath = resolve(options.out);
  if (statSync(sourcePath).isDirectory() && isInside(sourcePath, outputPath)) {
    throw new ExtractionError("Output directory must not be inside the installed source directory");
  }
  validateReplaceableOutput(outputPath);
  mkdirSync(dirname(outputPath), { recursive: true });
  const stagingPath = `${outputPath}.staging-${process.pid}`;
  rmSync(stagingPath, { force: true, recursive: true });
  mkdirSync(stagingPath);
  writeFileSync(join(stagingPath, OUTPUT_MARKER), "@mashed/extractor\n");

  let prepared: PreparedSource | undefined;
  try {
    prepared = await prepareSource(sourcePath);
    const files = await buildFiles(stagingPath, prepared);
    const manifest: AssetManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      tool: { name: "@mashed/extractor", version: TOOL_VERSION },
      source: prepared.source,
      files,
      summary: buildSummary(files),
    };
    writeFileSync(join(stagingPath, "manifest.json"), stableJson(manifest));
    commitOutput(stagingPath, outputPath);
    return manifest;
  } catch (error) {
    rmSync(stagingPath, { force: true, recursive: true });
    throw error;
  } finally {
    prepared?.cleanup?.();
  }
}
