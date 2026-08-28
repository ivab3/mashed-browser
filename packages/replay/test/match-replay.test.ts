import { describe, expect, it } from "vitest";

import {
  createStageFiveReplayScenario,
  runMatchReplay,
  type MatchReplayEvent,
} from "../src/index.js";

function hasEvent(events: readonly MatchReplayEvent[], type: string): boolean {
  return events.some((entry) => entry.source !== "camera" && entry.event.type === type);
}

describe("combined Stage 5 match replay", () => {
  it("keeps race, combat, and camera elimination identical at 30, 60, and 120 Hz", () => {
    const scenario = createStageFiveReplayScenario();
    const runs = [30, 60, 120].map((refreshRate) => (
      runMatchReplay(scenario.definition, scenario.tape, refreshRate)
    ));

    expect(runs[1]?.outcome).toEqual(runs[0]?.outcome);
    expect(runs[2]?.outcome).toEqual(runs[0]?.outcome);
    expect(runs[0]?.outcome.processedSteps).toBeGreaterThan(90);
    expect(runs[0]?.outcome.race.results.map((result) => [
      result.playerId,
      result.status,
      result.eliminationReason,
    ])).toEqual([
      ["vehicle-one", "winner", null],
      ["vehicle-two", "eliminated", "camera-distance"],
      ["vehicle-three", "eliminated", "camera-distance"],
      ["vehicle-four", "eliminated", "destroyed"],
    ]);
    expect(hasEvent(runs[0]!.outcome.events, "pickup-collected")).toBe(true);
    expect(hasEvent(runs[0]!.outcome.events, "weapon-fired")).toBe(true);
    expect(hasEvent(runs[0]!.outcome.events, "projectile-world-impact")).toBe(true);
    expect(hasEvent(runs[0]!.outcome.events, "projectile-expired")).toBe(true);
    expect(hasEvent(runs[0]!.outcome.events, "player-destroyed")).toBe(true);
    expect(hasEvent(runs[0]!.outcome.events, "race-finished")).toBe(true);
  });
});
