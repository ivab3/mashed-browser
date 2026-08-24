import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { VehicleConfig } from "./index.js";
import {
  compareVehicleTuningReports,
  runVehicleTuningSuite,
  type VehicleTuningReport,
} from "./tuning.js";

function usage(): string {
  return [
    "Usage: pnpm vehicle:tune [-- --config path/to/config.json] [--compare path/to/report.json]",
    "",
    "  --config   run the scenarios with an alternative VehicleConfig JSON file",
    "  --compare  include numeric deltas from a report or a { report } baseline file",
  ].join("\n");
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function loadJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function parseConfig(value: unknown, path: string): VehicleConfig {
  const object = requireObject(value, path);
  for (const key of [
    "id",
    "sourceStats",
    "spawn",
    "chassis",
    "wheels",
    "drive",
    "handling",
    "collisionResponse",
    "recovery",
    "surfaces",
  ]) {
    if (!(key in object)) {
      throw new Error(`${path} is missing VehicleConfig.${key}`);
    }
  }
  if (typeof object["id"] !== "string") {
    throw new Error(`${path} must define a string VehicleConfig.id`);
  }
  return object as unknown as VehicleConfig;
}

function parseReport(value: unknown, path: string): VehicleTuningReport {
  const object = requireObject(value, path);
  const report = "report" in object ? object["report"] : object;
  const reportObject = requireObject(report, path);
  if (reportObject["version"] !== 3 || typeof reportObject["stepSeconds"] !== "number") {
    throw new Error(`${path} is not a version 3 vehicle tuning report`);
  }
  return reportObject as unknown as VehicleTuningReport;
}

let configPath: string | undefined;
let comparePath: string | undefined;
const invocationDirectory = process.env["INIT_CWD"] ?? process.cwd();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--") {
    continue;
  }
  if (argument === "--help" || argument === "-h") {
    console.log(usage());
    process.exit(0);
  }
  if (argument === "--config" || argument === "--compare") {
    const value = args[index + 1];
    if (!value) {
      throw new Error(`${argument} requires a path\n\n${usage()}`);
    }
    if (argument === "--config") {
      configPath = resolve(invocationDirectory, value);
    } else {
      comparePath = resolve(invocationDirectory, value);
    }
    index += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
}

const config = configPath ? parseConfig(await loadJson(configPath), configPath) : undefined;
const report = await runVehicleTuningSuite(config);
if (!comparePath) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const reference = parseReport(await loadJson(comparePath), comparePath);
  const differences = compareVehicleTuningReports(reference, report);
  console.log(JSON.stringify({
    report,
    comparison: {
      reference: comparePath,
      metrics: differences.length,
      differences: differences.filter((difference) => Math.abs(difference.delta) >= 0.001),
    },
  }, null, 2));
}
