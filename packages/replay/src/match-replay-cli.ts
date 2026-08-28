import { createStageFiveReplayScenario } from "./stage-five-scenario.js";
import { runMatchReplay } from "./match-replay.js";

const scenario = createStageFiveReplayScenario();
const runs = [30, 60, 120].map((refreshRate) => (
  runMatchReplay(scenario.definition, scenario.tape, refreshRate)
));
const baseline = JSON.stringify(runs[0]!.outcome);
if (runs.some((run) => JSON.stringify(run.outcome) !== baseline)) {
  throw new Error("Stage 5 match replay diverged between presentation refresh rates");
}

const outcome = runs[0]!.outcome;
console.log(JSON.stringify({
  deterministic: true,
  matrix: runs.map((run) => ({
    refreshRate: run.refreshRate,
    presentationFrames: run.presentationFrames,
    processedSteps: run.outcome.processedSteps,
  })),
  elapsedRaceSeconds: outcome.race.elapsedRaceSeconds,
  elapsedCombatSeconds: outcome.combat.elapsedSeconds,
  results: outcome.race.results,
  eventCount: outcome.events.length,
}, null, 2));

