import { describe, expect, it } from "vitest";

import {
  RaceSession,
  type LapCheckpoint,
  type RaceEvent,
  type RacePlayerPositions,
} from "../src/index.js";

function checkpoint(id: number, centerX: number): LapCheckpoint {
  const left = centerX - 0.5;
  const right = centerX + 0.5;
  return {
    id,
    center: [centerX, 0, 0],
    triangles: [
      [[left, 0, -1], [right, 0, -1], [right, 0, 1]],
      [[left, 0, -1], [right, 0, 1], [left, 0, 1]],
    ],
  };
}

const course = {
  checkpoints: [checkpoint(0, 0), checkpoint(1, 2), checkpoint(2, 4)],
  splitCheckpointIds: [2],
};

function playerPosition(playerId: string, x: number): RacePlayerPositions {
  return { [playerId]: [x, 0, 0] };
}

function eventTypes(events: readonly RaceEvent[]): string[] {
  return events.map((event) => event.type);
}

describe("RaceSession", () => {
  it("validates the local player and lap limits", () => {
    expect(() => new RaceSession({ course, players: [], totalLaps: 1 })).toThrow(/between 1 and 4/);
    expect(() => new RaceSession({
      course,
      players: [{ id: "same" }, { id: "same" }],
      totalLaps: 1,
    })).toThrow(/duplicated/);
    expect(() => new RaceSession({ course, players: [{ id: "p1" }], totalLaps: 0 })).toThrow(
      /positive integer/,
    );
  });

  it("runs a deterministic countdown without accepting early checkpoints", () => {
    const race = new RaceSession({
      course,
      players: [{ id: "p1", displayName: "Player 1" }],
      totalLaps: 1,
      countdownSeconds: 3,
    });

    expect(race.snapshot).toMatchObject({
      phase: "countdown",
      countdownSecondsRemaining: 3,
      players: [{ status: "ready", progress: { passedCheckpoints: 0 } }],
    });
    expect(race.advance(1, playerPosition("p1", 2))).toEqual([
      { type: "countdown-tick", secondsRemaining: 2 },
    ]);
    expect(race.advance(1, playerPosition("p1", 2))).toEqual([
      { type: "countdown-tick", secondsRemaining: 1 },
    ]);
    expect(race.advance(1, playerPosition("p1", 2))).toEqual([{ type: "race-started" }]);
    expect(race.snapshot.players[0]).toMatchObject({ status: "racing", progress: { passedCheckpoints: 0 } });
    expect(race.advance(1 / 60, playerPosition("p1", 2))).toContainEqual({
      type: "checkpoint-passed",
      playerId: "p1",
      checkpointId: 1,
    });

    const fixedStepRace = new RaceSession({
      course,
      players: [{ id: "p1" }],
      totalLaps: 1,
      countdownSeconds: 3,
    });
    let lastFixedStepEvents: readonly RaceEvent[] = [];
    for (let frame = 0; frame < 180; frame += 1) {
      lastFixedStepEvents = fixedStepRace.advance(1 / 60);
    }
    expect(lastFixedStepEvents).toEqual([{ type: "race-started" }]);
    expect(fixedStepRace.phase).toBe("racing");
  });

  it("tracks ordered laps and produces results after the configured distance", () => {
    const race = new RaceSession({
      course,
      players: [{ id: "p1", displayName: "Player 1" }],
      totalLaps: 2,
      countdownSeconds: 0,
    });

    let lastEvents: readonly RaceEvent[] = [];
    for (const x of [2, 4, 0, 2, 4, 0]) {
      lastEvents = race.advance(0.5, playerPosition("p1", x));
    }

    expect(eventTypes(lastEvents)).toEqual([
      "checkpoint-passed",
      "lap-completed",
      "player-finished",
      "race-finished",
    ]);
    expect(race.snapshot).toMatchObject({
      phase: "finished",
      elapsedRaceSeconds: 3,
      players: [{ status: "finished", finishTimeSeconds: 3 }],
      results: [{ rank: 1, playerId: "p1", status: "finished", timeSeconds: 3 }],
    });
    expect(race.advance(1, playerPosition("p1", 2))).toEqual([]);
  });

  it("keeps multiplayer progress independent and ranks survivors ahead of earlier eliminations", () => {
    const race = new RaceSession({
      course,
      players: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
      totalLaps: 1,
      countdownSeconds: 0,
    });

    race.advance(1, { p1: [2, 0, 0], p2: [2, 0, 0], p3: [2, 0, 0] });
    expect(race.eliminatePlayer("p2", "camera-distance")).toEqual([
      { type: "player-eliminated", playerId: "p2", reason: "camera-distance" },
    ]);
    race.advance(1, { p1: [4, 0, 0], p3: [4, 0, 0] });
    expect(race.eliminatePlayer("p3", "destroyed")).toEqual([
      { type: "player-eliminated", playerId: "p3", reason: "destroyed" },
    ]);
    race.advance(1, playerPosition("p1", 0));

    expect(race.snapshot.players.map((player) => [player.id, player.status])).toEqual([
      ["p1", "finished"],
      ["p2", "eliminated"],
      ["p3", "eliminated"],
    ]);
    expect(race.snapshot.results.map((result) => result.playerId)).toEqual(["p1", "p3", "p2"]);
  });

  it("replays the same multiplayer position tape to an identical snapshot", () => {
    const run = () => {
      const race = new RaceSession({
        course,
        players: [{ id: "p1" }, { id: "p2" }],
        totalLaps: 1,
        countdownSeconds: 0,
      });
      for (const positions of [
        { p1: [2, 0, 0], p2: [2, 0, 0] },
        { p1: [4, 0, 0], p2: [4, 0, 0] },
        { p1: [0, 0, 0], p2: [0, 0, 0] },
      ] satisfies RacePlayerPositions[]) {
        race.advance(1 / 60, positions);
      }
      return race.snapshot;
    };

    expect(run()).toEqual(run());
  });
});
