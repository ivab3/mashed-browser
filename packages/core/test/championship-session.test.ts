import { describe, expect, it } from "vitest";

import {
  ChampionshipSession,
  type ChampionshipDefinition,
  type ChampionshipSaveV1,
} from "../src/index.js";

const definition: ChampionshipDefinition = {
  id: "alpha-cup",
  name: "Alpha Cup",
  entrants: [
    { id: "p1", displayName: "P1" },
    { id: "p2", displayName: "P2" },
    { id: "p3", displayName: "P3" },
    { id: "p4", displayName: "P4" },
  ],
  events: [
    { id: "warzone-standard", name: "Warzone Standard", courseId: 33, mode: "standard" },
    { id: "warzone-flag", name: "Warzone Flag", courseId: 33, mode: "hold-the-flag" },
    { id: "warzone-fugitive", name: "Warzone Fugitive", courseId: 33, mode: "fugitive" },
  ],
  pointsByRank: [5, 3, 2, 1],
};

describe("ChampionshipSession", () => {
  it("awards points, advances explicitly, and completes a multi-event series", () => {
    const session = new ChampionshipSession(definition);
    expect(session.snapshot.currentEvent.id).toBe("warzone-standard");
    expect(session.completeEvent(["p2", "p1", "p4", "p3"])[0]).toMatchObject({
      type: "championship-event-completed",
      awardedPoints: { p1: 3, p2: 5, p3: 1, p4: 2 },
    });
    expect(session.snapshot.phase).toBe("event-complete");
    expect(session.startNextEvent()).toEqual([{
      type: "championship-event-advanced",
      eventId: "warzone-flag",
      eventIndex: 1,
    }]);
    session.completeEvent(["p1", "p3", "p2", "p4"]);
    session.startNextEvent();
    const finalEvents = session.completeEvent(["p1", "p2", "p3", "p4"]);
    expect(finalEvents.at(-1)).toMatchObject({ type: "championship-completed", winnerId: "p1" });
    expect(session.snapshot.standings.map((standing) => [
      standing.entrantId,
      standing.points,
      standing.medal,
    ])).toEqual([
      ["p1", 13, "gold"],
      ["p2", 10, "silver"],
      ["p3", 6, "bronze"],
      ["p4", 4, "none"],
    ]);
  });

  it("uses wins, cumulative rank, and entrant order as deterministic tie breakers", () => {
    const session = new ChampionshipSession({
      ...definition,
      events: definition.events.slice(0, 2),
      pointsByRank: [3, 2, 1, 0],
    });
    session.completeEvent(["p2", "p1", "p3", "p4"]);
    session.startNextEvent();
    session.completeEvent(["p1", "p2", "p4", "p3"]);
    expect(session.snapshot.standings.slice(0, 2).map((standing) => standing.entrantId))
      .toEqual(["p1", "p2"]);
  });

  it("round-trips a versioned save without changing the snapshot", () => {
    const session = new ChampionshipSession(definition);
    session.completeEvent(["p3", "p2", "p1", "p4"]);
    session.startNextEvent();
    const restored = ChampionshipSession.restore(definition, structuredClone(session.save()));
    expect(restored.snapshot).toEqual(session.snapshot);
    expect(restored.save()).toEqual(session.save());
  });

  it("rejects invalid definitions, rankings, transitions, and saves", () => {
    expect(() => new ChampionshipSession({ ...definition, entrants: [definition.entrants[0]!] }))
      .toThrow(/between 2 and 4/);
    expect(() => new ChampionshipSession({ ...definition, events: [definition.events[0]!] }))
      .toThrow(/at least two/);
    expect(() => new ChampionshipSession({ ...definition, pointsByRank: [1, 2, 0, 0] }))
      .toThrow(/descending/);
    const session = new ChampionshipSession(definition);
    expect(() => session.completeEvent(["p1", "p1", "p2", "p3"])).toThrow(/exactly once/);
    expect(() => session.startNextEvent()).toThrow(/only after/);
    const invalidSave: ChampionshipSaveV1 = {
      ...session.save(),
      championshipId: "other",
    };
    expect(() => ChampionshipSession.restore(definition, invalidSave)).toThrow(/does not match/);
  });
});
