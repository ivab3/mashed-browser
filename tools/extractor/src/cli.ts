#!/usr/bin/env node

import process from "node:process";

import { ExtractionError } from "./errors.js";
import { extractAssets } from "./extract.js";
import { inspectManifest } from "./inspect.js";

interface CliOptions {
  source?: string;
  out?: string;
  manifest?: string;
  json: boolean;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm extract --source /path/to/game.cue --out ./game-data",
    "  pnpm extract --source /path/to/installed-game --out ./game-data",
    "  pnpm assets:inspect --manifest ./game-data/manifest.json [--json]",
  ].join("\n");
}

function parseOptions(arguments_: string[]): CliOptions {
  const options: CliOptions = { json: false };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--source" || argument === "--out" || argument === "--manifest") {
      const value = arguments_[index + 1];
      if (!value) {
        throw new ExtractionError(`Missing value for ${argument}`);
      }
      options[argument.slice(2) as "source" | "out" | "manifest"] = value;
      index += 1;
      continue;
    }
    throw new ExtractionError(`Unknown argument: ${argument}`);
  }
  return options;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = parseOptions(process.argv.slice(3));
  if (command === "extract") {
    if (!options.source || !options.out) {
      throw new ExtractionError("extract requires --source and --out");
    }
    const manifest = await extractAssets({ source: options.source, out: options.out });
    process.stdout.write(
      `Extracted ${manifest.summary.fileCount} files (${manifest.summary.totalSizeBytes} bytes) to ${options.out}\n`,
    );
    return;
  }
  if (command === "inspect") {
    if (!options.manifest) {
      throw new ExtractionError("inspect requires --manifest");
    }
    const result = inspectManifest(options.manifest);
    process.stdout.write(options.json ? `${JSON.stringify(result.manifest, null, 2)}\n` : result.output);
    if (Object.values(result.manifest.summary.required).some((requirement) => !requirement.found)) {
      process.exitCode = 2;
    }
    return;
  }
  throw new ExtractionError(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage()}\n`);
  process.exitCode = 1;
});
