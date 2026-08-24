import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveTrackDefinition,
  parseBspWorld,
  parseLapDataLua,
} from "@mashed/assets";

import { runLapValidation } from "./lap-validation.js";

const workspaceDirectory = fileURLToPath(new URL("../../..", import.meta.url));
const trackDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(workspaceDirectory, "game-data/expanded/piz/TOASTART/TRACKS/Warzone");
const [ai, collision, lapData] = await Promise.all([
  readFile(resolve(trackDirectory, "AI1.BSP")),
  readFile(resolve(trackDirectory, "COLLIDE.BSP")),
  readFile(resolve(trackDirectory, "LAPDATA.LUA"), "utf8"),
]);
const course = deriveTrackDefinition(parseBspWorld(ai), parseLapDataLua(lapData));
const collisionWorld = parseBspWorld(collision);
const report = await runLapValidation(course, collisionWorld.worldSectors);

console.log(JSON.stringify({
  trackDirectory,
  ...report,
}, null, 2));

if (!report.completed || report.recoveryFrames > 0) {
  process.exitCode = 1;
}
