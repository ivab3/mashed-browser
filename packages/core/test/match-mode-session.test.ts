import { describe, expect, it } from "vitest";

import { MatchModeSession } from "../src/index.js";

const players = [
  { id: "p1", displayName: "P1" },
  { id: "p2", displayName: "P2" },
  { id: "p3", displayName: "P3" },
  { id: "p4", displayName: "P4" },
];

describe("MatchModeSession", () => {
  it("scores deterministic Standard Play rounds and finishes at the target", () => {
    const session = new MatchModeSession({ mode: "standard", players, pointsToWin: 2 });
    expect(session.advance(1 / 60, { activePlayerIds: ["p2"] })).toEqual([
      { type: "score-awarded", playerIds: ["p2"], score: 1 },
      { type: "round-completed", round: 1, winnerIds: ["p2"], reason: "last-player" },
    ]);
    expect(session.snapshot.phase).toBe("round-complete");
    session.startNextRound();
    expect(session.advance(1 / 60, { activePlayerIds: ["p2"] })).toEqual([
      { type: "score-awarded", playerIds: ["p2"], score: 2 },
      { type: "round-completed", round: 2, winnerIds: ["p2"], reason: "last-player" },
      { type: "match-completed", winnerIds: ["p2"], score: 2 },
    ]);
    expect(session.snapshot.matchWinnerIds).toEqual(["p2"]);
  });

  it("keeps Team Play score separate from individual score", () => {
    const session = new MatchModeSession({
      mode: "team",
      players: [
        { id: "p1", teamId: "red" },
        { id: "p2", teamId: "blue" },
        { id: "p3", teamId: "red" },
        { id: "p4", teamId: "blue" },
      ],
      pointsToWin: 1,
    });
    expect(session.advance(0.1, { activePlayerIds: ["p1", "p3"] })).toEqual([
      { type: "score-awarded", playerIds: ["p1", "p3"], teamId: "red", score: 1 },
      { type: "round-completed", round: 1, winnerIds: ["p1", "p3"], reason: "last-team" },
      { type: "match-completed", winnerIds: ["p1", "p3"], score: 1 },
    ]);
    expect(session.snapshot.teams).toMatchObject([{ id: "red", score: 1 }, { id: "blue", score: 0 }]);
    expect(session.snapshot.players.every((player) => player.score === 0)).toBe(true);
  });

  it("captures, transfers, drops, and scores the flag on simulation time", () => {
    const session = new MatchModeSession({
      mode: "hold-the-flag",
      players,
      pointsToWin: 2,
      flagHoldSeconds: 1,
    });
    expect(session.advance(0.4, { activePlayerIds: ["p1", "p2"], flagCapturePlayerId: "p1" }))
      .toEqual([{ type: "flag-captured", playerId: "p1" }]);
    expect(session.advance(0.2, { activePlayerIds: ["p1", "p2"], flagCapturePlayerId: "p2" }))
      .toEqual([
        { type: "flag-dropped", playerId: "p1" },
        { type: "flag-captured", playerId: "p2" },
      ]);
    expect(session.advance(0.3, { activePlayerIds: ["p1"] })).toEqual([
      { type: "flag-dropped", playerId: "p2" },
    ]);
    session.advance(0.5, { activePlayerIds: ["p1", "p2"], flagCapturePlayerId: "p1" });
    expect(session.advance(0.5, { activePlayerIds: ["p1", "p2"] })).toContainEqual({
      type: "round-completed",
      round: 1,
      winnerIds: ["p1"],
      reason: "flag-held",
    });
  });

  it("rotates the fugitive after survival and credits an interceptor", () => {
    const session = new MatchModeSession({
      mode: "fugitive",
      players,
      pointsToWin: 3,
      fugitiveSurvivalSeconds: 1,
    });
    expect(session.snapshot.fugitiveId).toBe("p1");
    expect(session.advance(1, { activePlayerIds: ["p1", "p2", "p3", "p4"] }))
      .toContainEqual(expect.objectContaining({ reason: "fugitive-survived", winnerIds: ["p1"] }));
    expect(session.startNextRound()).toEqual([
      { type: "fugitive-assigned", playerId: "p2", round: 2 },
    ]);
    expect(session.advance(0.1, {
      activePlayerIds: ["p1", "p3", "p4"],
      fugitiveEliminatedByPlayerId: "p3",
    })).toContainEqual(expect.objectContaining({ reason: "fugitive-intercepted", winnerIds: ["p3"] }));
  });

  it("replays identical mode frames to an identical snapshot", () => {
    const run = () => {
      const session = new MatchModeSession({
        mode: "hold-the-flag",
        players,
        pointsToWin: 2,
        flagHoldSeconds: 0.5,
      });
      session.advance(0.25, { activePlayerIds: ["p1", "p2"], flagCapturePlayerId: "p2" });
      session.advance(0.25, { activePlayerIds: ["p1", "p2"] });
      return session.snapshot;
    };
    expect(run()).toEqual(run());
  });

  it("rejects invalid teams, frames, and transitions", () => {
    expect(() => new MatchModeSession({ mode: "standard", players: [players[0]!] }))
      .toThrow(/between 2 and 4/);
    expect(() => new MatchModeSession({ mode: "team", players }))
      .toThrow(/two non-empty teams/);
    const session = new MatchModeSession({ mode: "standard", players });
    expect(() => session.startNextRound()).toThrow(/only after/);
    expect(() => session.advance(0, { activePlayerIds: [] })).toThrow(/stepSeconds/);
    expect(() => session.advance(0.1, { activePlayerIds: ["missing"] })).toThrow(/Unknown/);
  });
});
