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
const useAiDriver = process.argv.includes("--ai");
const trackArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const trackDirectory = trackArgument
  ? resolve(trackArgument)
  : resolve(workspaceDirectory, "game-data/expanded/piz/TOASTART/TRACKS/Warzone");
const [ai, collision, lapData] = await Promise.all([
  readFile(resolve(trackDirectory, "AI1.BSP")),
  readFile(resolve(trackDirectory, "COLLIDE.BSP")),
  readFile(resolve(trackDirectory, "LAPDATA.LUA"), "utf8"),
]);
const course = deriveTrackDefinition(parseBspWorld(ai), parseLapDataLua(lapData));
const collisionWorld = parseBspWorld(collision);
const report = await runLapValidation(course, collisionWorld.worldSectors, useAiDriver
  ? { aiDifficulty: "hard", aiSeed: 0xa1_6_4 }
  : {});
const accepted = report.completed
  && report.recoveryFrames === 0
  && (!useAiDriver || (report.elapsedSeconds <= 75 && report.reverseFrames <= 180));

console.log(JSON.stringify({
  trackDirectory,
  driver: useAiDriver ? "production-ai-hard" : "acceptance-driver",
  accepted,
  ...report,
}, null, 2));

if (!accepted) {
  process.exitCode = 1;
}
