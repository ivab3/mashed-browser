import { describe, expect, it } from "vitest";
import { runAlphaSeriesReplay } from "../src/alpha-series-replay.js";

describe("production alpha series rules", () => {
  it.each([2, 3, 4])("completes, restores every boundary and restarts with %i players at 30/60/120 Hz", (count) => {
    const outcomes = [30, 60, 120].map((hz) => runAlphaSeriesReplay(count, 33, hz));
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    const outcome = outcomes[0]!;
    expect(outcome.finished.phase).toBe("finished");
    expect(outcome.finished.completedEvents).toHaveLength(3);
    expect(outcome.saves).toHaveLength(6);
    expect(outcome.rounds.map((round) => round.events.at(-2)?.event)).toMatchObject([
      { type: "round-completed", reason: "last-player" },
      { type: "round-completed", reason: "flag-held" },
      { type: "round-completed", reason: "fugitive-survived" },
    ]);
    expect(outcome.finished.standings[0]).toMatchObject({ entrantId: "vehicle-one", medal: "gold" });
    expect(outcome.restarted.phase).toBe("event-ready");
    expect(outcome.restarted.standings.every((player) => player.points === 0 && player.medal === "none")).toBe(true);
  });
});
