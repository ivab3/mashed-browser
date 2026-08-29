import type {
  MatchModeFrame,
  MatchModeSessionOptions,
  MatchModeType,
} from "@mashed/core";
import { describe, expect, it } from "vitest";

import {
  ReplayRecorder,
  runMatchModeReplay,
  type MatchModeReplayOutcome,
  type ReplayTape,
} from "../src/index.js";

const PLAYER_IDS = ["vehicle-one", "vehicle-two", "vehicle-three", "vehicle-four"] as const;

function definition(mode: MatchModeType): MatchModeSessionOptions {
  return {
    mode,
    players: PLAYER_IDS.map((id, index) => ({
      id,
      displayName: `P${index + 1}`,
      teamId: index % 2 === 0 ? "Orange" : "Blue",
    })),
    pointsToWin: 3,
    flagHoldSeconds: 0.5,
    fugitiveSurvivalSeconds: 1,
  };
}

function tapeFor(mode: MatchModeType): ReplayTape<MatchModeFrame> {
  const recorder = new ReplayRecorder<MatchModeFrame>(0x6_3_2026, 1 / 60);
  for (let step = 0; step < 90; step += 1) {
    const activePlayerIds = mode === "standard" || mode === "team"
      ? (step < 30 ? PLAYER_IDS : ["vehicle-one"])
      : PLAYER_IDS;
    recorder.record({
      activePlayerIds,
      ...(mode === "hold-the-flag" ? { flagCapturePlayerId: "vehicle-two" } : {}),
      ...(mode === "fugitive" && step === 30
        ? { completedLapPlayerIds: ["vehicle-one"] }
        : {}),
    });
  }
  return recorder.finish();
}

function runAtPresentationRates(mode: MatchModeType): readonly MatchModeReplayOutcome[] {
  const tape = tapeFor(mode);
  return [30, 60, 120].map((refreshRate) => (
    runMatchModeReplay(definition(mode), tape, refreshRate).outcome
  ));
}

describe("local match mode replay determinism", () => {
  it.each([
    ["standard", "vehicle-one", "last-player"],
    ["team", "vehicle-one", "last-team"],
    ["hold-the-flag", "vehicle-two", "flag-held"],
    ["fugitive", "vehicle-one", "fugitive-survived"],
  ] as const)("keeps %s identical at 30, 60, and 120 Hz", (mode, winnerId, reason) => {
    const outcomes = runAtPresentationRates(mode);
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    expect(outcomes[0]?.snapshot.phase).toBe("round-complete");
    expect(outcomes[0]?.snapshot.roundWinnerIds).toContain(winnerId);
    expect(outcomes[0]?.events.at(-1)?.event).toMatchObject({
      type: "round-completed",
      reason,
    });
  });
});
