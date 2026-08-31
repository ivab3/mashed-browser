import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runLapValidation } from "./lap-validation.js";
import { loadLapValidationData } from "./lap-validation-data.js";

const workspaceDirectory = fileURLToPath(new URL("../../..", import.meta.url));
const useAiDriver = process.argv.includes("--ai");
const trackArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
const trackDirectory = trackArgument
  ? resolve(trackArgument)
  : resolve(workspaceDirectory, "game-data/expanded/piz/TOASTART/TRACKS/Warzone");
const { course, collision: collisionWorld } = await loadLapValidationData(trackDirectory);
const report = await runLapValidation(course, collisionWorld.worldSectors, useAiDriver
  ? { aiDifficulty: "hard", aiSeed: 0xa1_6_4 }
  : {});
const accepted = report.completed
  && report.recoveryFrames === 0
  && report.recoveryOperations === 0
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
