import {
  FixedStepClock,
  MatchModeSession,
  type MatchModeEvent,
  type MatchModeFrame,
  type MatchModeSessionOptions,
  type MatchModeSnapshot,
} from "@mashed/core";

import type { ReplayTape } from "./index.js";

export type MatchModeReplayFrame = MatchModeFrame;

export interface MatchModeReplayEvent {
  step: number;
  event: MatchModeEvent;
}

export interface MatchModeReplayOutcome {
  processedSteps: number;
  snapshot: MatchModeSnapshot;
  events: readonly MatchModeReplayEvent[];
}

export interface MatchModeReplayRun {
  refreshRate: number;
  presentationFrames: number;
  outcome: MatchModeReplayOutcome;
}

/** Replays one local-mode round behind an arbitrary presentation clock. */
export function runMatchModeReplay(
  definition: MatchModeSessionOptions,
  tape: ReplayTape<MatchModeReplayFrame>,
  refreshRate: number,
): MatchModeReplayRun {
  if (!Number.isFinite(refreshRate) || refreshRate <= 0) {
    throw new Error("Match mode replay refreshRate must be a finite positive number");
  }

  const clock = new FixedStepClock({ stepSeconds: tape.stepSeconds });
  const session = new MatchModeSession(definition);
  const events: MatchModeReplayEvent[] = [];
  let processedSteps = 0;
  let presentationFrames = 0;

  const simulate = (stepSeconds: number, step: number): void => {
    if (session.snapshot.phase !== "playing") {
      return;
    }
    const frame = tape.frames[processedSteps];
    if (!frame) {
      throw new Error(
        `Match mode replay exhausted after ${processedSteps} steps before the round finished`,
      );
    }
    processedSteps += 1;
    for (const event of session.advance(stepSeconds, frame)) {
      events.push({ step, event });
    }
  };

  clock.advance(0, simulate);
  const maximumPresentationFrames = Math.ceil(
    tape.frames.length * tape.stepSeconds * refreshRate,
  ) + 1;
  while (session.snapshot.phase === "playing" && presentationFrames < maximumPresentationFrames) {
    presentationFrames += 1;
    clock.advance(presentationFrames / refreshRate, simulate);
  }
  if (session.snapshot.phase === "playing") {
    throw new Error(
      `Match mode replay did not finish within ${tape.frames.length} recorded steps`,
    );
  }

  return {
    refreshRate,
    presentationFrames,
    outcome: {
      processedSteps,
      snapshot: session.snapshot,
      events,
    },
  };
}
