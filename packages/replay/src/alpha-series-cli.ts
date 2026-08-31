import { runAlphaSeriesReplay } from "./alpha-series-replay.js";

const matrix = [0, 26, 33, 39].flatMap((courseId) => [2, 3, 4].map((playerCount) => {
  const runs = [30, 60, 120].map((hz) => runAlphaSeriesReplay(playerCount, courseId, hz));
  if (runs.some((run) => JSON.stringify(run) !== JSON.stringify(runs[0]))) {
    throw new Error(`Alpha series diverged for course ${courseId}, ${playerCount} players`);
  }
  const outcome = runs[0]!;
  return {
    courseId, playerCount, presentationRates: [30, 60, 120],
    completedEvents: outcome.finished.completedEvents.length,
    restoreBoundaries: outcome.saves.length,
    standings: outcome.finished.standings.map(({ entrantId, points, medal }) => ({ entrantId, points, medal })),
  };
}));
console.log(JSON.stringify({ version: 1, deterministic: true, scope: "rules-and-save-only", matrix }, null, 2));
