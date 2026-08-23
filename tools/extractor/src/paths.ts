import { relative, resolve, sep } from "node:path";

import { ExtractionError } from "./errors.js";

export function toManifestPath(path: string): string {
  return path.split(sep).join("/");
}

export function safeRelativePath(path: string, context: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");

  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    parts.some((part) => part === "" || part === "." || part === ".." || part.includes("\0"))
  ) {
    throw new ExtractionError(`Unsafe ${context} path: ${JSON.stringify(path)}`);
  }

  return parts.join("/");
}

export function isInside(parentPath: string, candidatePath: string): boolean {
  const parent = resolve(parentPath);
  const candidate = resolve(candidatePath);
  const pathFromParent = relative(parent, candidate);
  return pathFromParent === "" || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..");
}
