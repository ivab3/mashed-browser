import {
  AiRouteDriver,
  FixedStepClock,
  type AiRouteDriverOptions,
  type AiRouteDriverSnapshot,
  type AiRouteDriverState,
  type AiVehicleInput,
} from "@mashed/core";

import type { ReplayTape } from "./index.js";

export interface AiDriverReplayOutcome {
  processedSteps: number;
  inputs: readonly AiVehicleInput[];
  snapshot: AiRouteDriverSnapshot;
}

export interface AiDriverReplayRun {
  refreshRate: number;
  presentationFrames: number;
  outcome: AiDriverReplayOutcome;
}

/** Replays a route driver tape behind an arbitrary presentation clock. */
export function runAiDriverReplay(
  definition: AiRouteDriverOptions,
  tape: ReplayTape<AiRouteDriverState>,
  refreshRate: number,
): AiDriverReplayRun {
  if (!Number.isFinite(refreshRate) || refreshRate <= 0) {
    throw new Error("AI driver replay refreshRate must be a finite positive number");
  }
  const clock = new FixedStepClock({ stepSeconds: tape.stepSeconds });
  const driver = new AiRouteDriver(definition);
  const inputs: AiVehicleInput[] = [];
  let processedSteps = 0;
  let presentationFrames = 0;

  const simulate = (stepSeconds: number): void => {
    const frame = tape.frames[processedSteps];
    if (!frame) {
      return;
    }
    processedSteps += 1;
    inputs.push(driver.advance(stepSeconds, frame));
  };
  clock.advance(0, simulate);
  const totalSeconds = tape.frames.length * tape.stepSeconds;
  const frameCount = Math.ceil(totalSeconds * refreshRate);
  for (presentationFrames = 1; presentationFrames <= frameCount; presentationFrames += 1) {
    clock.advance(presentationFrames / refreshRate, simulate);
  }
  if (processedSteps !== tape.frames.length) {
    throw new Error(
      `AI driver replay processed ${processedSteps} of ${tape.frames.length} recorded steps`,
    );
  }

  return {
    refreshRate,
    presentationFrames: frameCount,
    outcome: {
      processedSteps,
      inputs,
      snapshot: driver.snapshot,
    },
  };
}
