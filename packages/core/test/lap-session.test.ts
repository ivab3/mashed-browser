import { describe, expect, it } from "vitest";

import { LapSession, type LapCheckpoint } from "../src/index.js";

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

describe("LapSession", () => {
  it("only accepts ordered checkpoints and completes on returning to the start", () => {
    const session = new LapSession({
      checkpoints: [checkpoint(0, 0), checkpoint(1, 2), checkpoint(2, 4)],
      splitCheckpointIds: [2],
    });

    expect(session.progress).toEqual({
      completedLaps: 0,
      passedCheckpoints: 0,
      totalCheckpoints: 3,
      nextCheckpointId: 1,
      sectorIndex: 0,
    });
    expect(session.update([4, 0, 0]).checkpointPassed).toBeNull();
    expect(session.update([2, 0, 0])).toMatchObject({ checkpointPassed: 1, lapCompleted: false });
    expect(session.update([4, 0, 0])).toEqual({
      checkpointPassed: 2,
      splitPassed: 2,
      lapCompleted: false,
    });
    expect(session.progress).toMatchObject({ passedCheckpoints: 2, nextCheckpointId: 0, sectorIndex: 1 });
    expect(session.update([0, 0, 0]).lapCompleted).toBe(true);
    expect(session.progress).toMatchObject({ completedLaps: 1, passedCheckpoints: 0, nextCheckpointId: 1 });
  });

  it("resets progress without rebuilding the course", () => {
    const session = new LapSession({ checkpoints: [checkpoint(10, 0), checkpoint(20, 2)] });
    session.update([2, 0, 0]);
    session.update([0, 0, 0]);
    session.reset();
    expect(session.progress).toMatchObject({ completedLaps: 0, passedCheckpoints: 0, nextCheckpointId: 20 });
  });
});
