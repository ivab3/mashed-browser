import type { AiRouteDriverState, LapCheckpoint } from "@mashed/core";
import { describe, expect, it } from "vitest";

import { ReplayRecorder, runAiDriverReplay } from "../src/index.js";

function checkpoint(id: number, x: number, z: number): LapCheckpoint {
  return {
    id,
    center: [x, 0, z],
    triangles: [[[x - 2, -1, z], [x + 2, -1, z], [x, 1, z]]],
  };
}

function routeTape() {
  const recorder = new ReplayRecorder<AiRouteDriverState>(0xa1_6_4, 1 / 60);
  for (let step = 0; step < 360; step += 1) {
    const checkpointId = Math.floor(step / 90) + 1;
    recorder.record({
      position: [step / 30, 0, 0],
      headingRadians: Math.PI / 2 - Math.sin(step / 45) * 0.15,
      speedMetersPerSecond: 4 + Math.sin(step / 20),
      precedingCheckpoint: checkpoint(checkpointId - 1, checkpointId * 10 - 10, 0),
      checkpoint: checkpoint(checkpointId, checkpointId * 10, 0),
      followingCheckpoint: checkpoint(checkpointId + 1, checkpointId * 10 + 10, 0),
    });
  }
  return recorder.finish();
}

describe("AI driver replay determinism", () => {
  it("produces identical steering and item decisions at 30, 60, and 120 Hz", () => {
    const tape = routeTape();
    const runs = [30, 60, 120].map((refreshRate) => runAiDriverReplay(
      { difficulty: "hard", seed: tape.seed },
      tape,
      refreshRate,
    ));
    expect(runs[1]?.outcome).toEqual(runs[0]?.outcome);
    expect(runs[2]?.outcome).toEqual(runs[0]?.outcome);
    expect(runs[0]?.outcome.processedSteps).toBe(360);
    expect(runs[0]?.outcome.inputs.some((input) => input.useItem)).toBe(true);
  });
});
