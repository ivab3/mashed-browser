import { describe, expect, it } from "vitest";
import { createAlphaChampionshipDefinition, createAlphaMatchOptions, rankChampionshipEvent } from "../src/index.js";

describe("shared alpha rules", () => {
  it("retains v1 save identities, explicit course metadata and real match thresholds", () => {
    const definition = createAlphaChampionshipDefinition(4, 0, "Arctic");
    expect(definition.id).toBe("alpha-cup-v1-0-4p");
    expect(definition.events[0]).toEqual({ id: "standard", name: "Arctic · Standard Play", mode: "standard", courseId: 0 });
    expect(createAlphaChampionshipDefinition(2).id).toBe("alpha-cup-v1-route-2p");
    expect(createAlphaMatchOptions("team", definition.entrants, false)).toMatchObject({
      pointsToWin: 8, flagHoldSeconds: 12, fugitiveSurvivalSeconds: 45,
      players: [{ teamId: "Orange" }, { teamId: "Blue" }, { teamId: "Orange" }, { teamId: "Blue" }],
    });
    expect(() => createAlphaChampionshipDefinition(1)).toThrow();
    expect(() => createAlphaChampionshipDefinition(3, -1)).toThrow();
  });
  it("ranks survivors before eliminated players, with unique winners and stable progress ties", () => {
    const players = ["a", "b", "c", "d"].map((id) => ({ id, completedLaps: 0, passedCheckpoints: 5 }));
    expect(rankChampionshipEvent(players, ["b", "b", "unknown"], ["a", "d", "d"]))
      .toEqual(["b", "c", "d", "a"]);
    players[2]!.completedLaps = 1;
    players[3]!.passedCheckpoints = 10;
    expect(rankChampionshipEvent(players, [], [])).toEqual(["c", "d", "a", "b"]);
  });
});
