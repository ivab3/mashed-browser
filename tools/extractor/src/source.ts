import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { ExtractionError, invariant } from "./errors.js";
import { toManifestPath } from "./paths.js";

export const DEFAULT_RUNTIME_EXCLUSIONS = [
  "controllercfg.bin",
  "gamesave.bin",
  "mashed.log",
  "videocfg.bin",
] as const;

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
}

function walk(currentPath: string, rootPath: string, files: SourceFile[]): void {
  const children = readdirSync(currentPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  for (const child of children) {
    const childPath = join(currentPath, child.name);
    if (child.isSymbolicLink()) {
      throw new ExtractionError(`Symbolic links are not supported in installed sources: ${childPath}`);
    }
    if (child.isDirectory()) {
      walk(childPath, rootPath, files);
    } else if (child.isFile()) {
      files.push({
        absolutePath: childPath,
        relativePath: toManifestPath(relative(rootPath, childPath)),
      });
    } else {
      throw new ExtractionError(`Unsupported filesystem entry in installed source: ${childPath}`);
    }
  }
}

export function listFiles(rootPath: string): SourceFile[] {
  const files: SourceFile[] = [];
  walk(resolve(rootPath), resolve(rootPath), files);
  return files;
}

export function findGameRoot(sourceDirectory: string): string {
  const sourcePath = resolve(sourceDirectory);
  invariant(lstatSync(sourcePath).isDirectory(), `Installed source is not a directory: ${sourcePath}`);
  const executableMatches = listFiles(sourcePath).filter(
    (file) => basename(file.absolutePath).toLocaleLowerCase("en-US") === "mfl.exe",
  );
  if (executableMatches.length !== 1) {
    throw new ExtractionError(
      `Expected exactly one MFL.exe below ${sourcePath}, found ${executableMatches.length}`,
    );
  }
  return dirname(executableMatches[0]!.absolutePath);
}

export function copyGameFiles(
  sourceRoot: string,
  targetRoot: string,
  ignoreRuntimeFiles: boolean,
): SourceFile[] {
  const excluded = new Set<string>(DEFAULT_RUNTIME_EXCLUSIONS);
  const files = listFiles(sourceRoot).filter((file) => {
    if (!ignoreRuntimeFiles || file.relativePath.includes("/")) {
      return true;
    }
    return !excluded.has(file.relativePath.toLocaleLowerCase("en-US"));
  });
  for (const file of files) {
    const targetPath = join(targetRoot, ...file.relativePath.split("/"));
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(file.absolutePath, targetPath);
  }
  return files;
}
