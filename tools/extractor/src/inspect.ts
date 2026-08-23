import { resolve } from "node:path";

import { readManifest, type AssetKind, type AssetManifest, type RequiredAsset } from "./manifest.js";

const REQUIREMENT_LABELS: Record<RequiredAsset, string> = {
  executable: "MFL.exe",
  wildfire: "Wildfire vehicle archive",
  warzone: "Warzone track archive",
  luaScript: "Lua script",
  sound: "RWS sound",
  video: "MPEG video",
};

export function formatInspection(manifest: AssetManifest): string {
  const lines = [
    `Manifest schema: ${manifest.schemaVersion}`,
    `Source: ${manifest.source.kind}`,
    `Files: ${manifest.summary.fileCount}`,
    `Total bytes: ${manifest.summary.totalSizeBytes}`,
    "Types:",
  ];
  for (const [type, count] of Object.entries(manifest.summary.byType).sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  ) as Array<[AssetKind, number]>) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push("Required assets:");
  for (const key of Object.keys(REQUIREMENT_LABELS) as RequiredAsset[]) {
    const result = manifest.summary.required[key];
    lines.push(`  ${result.found ? "OK" : "MISSING"} ${REQUIREMENT_LABELS[key]}${result.path ? ` — ${result.path}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

export function inspectManifest(path: string): { manifest: AssetManifest; output: string } {
  const manifest = readManifest(resolve(path));
  return { manifest, output: formatInspection(manifest) };
}
