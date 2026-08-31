import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALPHA_CONTENT_BATCHES } from "@mashed/assets";
import { loadLapValidationData } from "./lap-validation-data.js";
import { runLapValidation } from "./lap-validation.js";

const workspaceDirectory = fileURLToPath(new URL("../../..", import.meta.url));
const contentRoot = resolve(process.argv[2] ?? resolve(workspaceDirectory, "game-data/expanded/piz/TOASTART"));
const tracks = ALPHA_CONTENT_BATCHES.flatMap((batch) => batch.tracks);
const reports = [];
for (const track of tracks) {
  const { course, collision } = await loadLapValidationData(resolve(contentRoot, "TRACKS", track.directoryName));
  for (const { seed, settlingSteps } of [
    { seed: 0xa1_6_4, settlingSteps: 0 },
    { seed: 0xa164_0100, settlingSteps: 0 },
    // The browser starts driving on the countdown's last tick: 179 neutral frames at 60 Hz.
    { seed: 0xa164_0100, settlingSteps: 179 },
  ]) {
    const options = { aiDifficulty: "hard" as const, aiSeed: seed, settlingSteps, maximumSteps: 180 * 60 };
    const first = await runLapValidation(course, collision.worldSectors, options);
    const second = await runLapValidation(course, collision.worldSectors, options);
    const deterministic = JSON.stringify(first) === JSON.stringify(second);
    reports.push({
      trackId: track.id, seed, settlingSteps, deterministic,
      accepted: deterministic && first.completed && first.recoveryFrames === 0 && first.recoveryOperations === 0,
      completed: first.completed, checkpoints: first.totalCheckpoints,
      elapsedSeconds: first.elapsedSeconds, reverseSeconds: first.reverseFrames / 60,
      recoveryFrames: first.recoveryFrames, nextCheckpointId: first.nextCheckpointId,
      recoveryOperations: first.recoveryOperations,
    });
  }
}
const accepted = reports.length > 0 && reports.every((report) => report.accepted);
console.log(JSON.stringify({ version: 1, accepted, scope: "solo-hard-ai-physics", maximumSeconds: 180, reports }, null, 2));
if (!accepted) process.exitCode = 1;
