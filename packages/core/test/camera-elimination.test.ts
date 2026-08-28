import { describe, expect, it } from "vitest";

import {
  CameraEliminationTracker,
  type CameraEliminationSubject,
} from "../src/index.js";

function subject(
  id: string,
  x: number,
  progress: Partial<Pick<CameraEliminationSubject, "completedLaps" | "passedCheckpoints" | "distanceToNextCheckpointMeters">> = {},
): CameraEliminationSubject {
  return {
    id,
    position: [x, 0, 0],
    completedLaps: progress.completedLaps ?? 0,
    passedCheckpoints: progress.passedCheckpoints ?? 0,
    distanceToNextCheckpointMeters: progress.distanceToNextCheckpointMeters ?? 10,
  };
}

describe("CameraEliminationTracker", () => {
  const config = {
    maximumDistanceFromLeaderMeters: 10,
    maximumDistanceFromCenterMeters: 8,
    graceSeconds: 1,
  };

  it("warns and then eliminates a trailing player after fixed-step grace", () => {
    const tracker = new CameraEliminationTracker(config);
    const racers = [subject("leader", 0, { passedCheckpoints: 1 }), subject("trailer", -12)];
    expect(tracker.update(0.4, racers)).toMatchObject({
      leaderId: "leader",
      warnings: [{ playerId: "trailer", secondsRemaining: 0.6 }],
      eliminatedPlayerIds: [],
    });
    expect(tracker.update(0.4, racers).warnings[0]?.secondsRemaining).toBeCloseTo(0.2);
    expect(tracker.update(0.2, racers)).toEqual({
      leaderId: "leader",
      warnings: [],
      eliminatedPlayerIds: ["trailer"],
    });
  });

  it("resets accumulated danger after a player returns to the camera pack", () => {
    const tracker = new CameraEliminationTracker(config);
    tracker.update(0.75, [subject("leader", 0, { passedCheckpoints: 1 }), subject("p2", -12)]);
    expect(tracker.update(0.25, [subject("leader", 0, { passedCheckpoints: 1 }), subject("p2", -2)]).warnings).toEqual([]);
    expect(tracker.update(0.5, [subject("leader", 0, { passedCheckpoints: 1 }), subject("p2", -12)])).toMatchObject({
      warnings: [{ playerId: "p2", secondsRemaining: 0.5 }],
      eliminatedPlayerIds: [],
    });
  });

  it("selects the route leader by lap, checkpoint, checkpoint distance, then input order", () => {
    const tracker = new CameraEliminationTracker(config);
    expect(tracker.update(0.1, [
      subject("p1", 0, { completedLaps: 1, passedCheckpoints: 2, distanceToNextCheckpointMeters: 3 }),
      subject("p2", 1, { completedLaps: 2 }),
    ]).leaderId).toBe("p2");
    tracker.reset();
    expect(tracker.update(0.1, [
      subject("p1", 0, { passedCheckpoints: 2, distanceToNextCheckpointMeters: 5 }),
      subject("p2", 1, { passedCheckpoints: 2, distanceToNextCheckpointMeters: 3 }),
    ]).leaderId).toBe("p2");
    tracker.reset();
    expect(tracker.update(0.1, [subject("p1", 0), subject("p2", 1)]).leaderId).toBe("p1");
  });

  it("returns simultaneous eliminations in stable subject order", () => {
    const tracker = new CameraEliminationTracker({ ...config, graceSeconds: 0 });
    expect(tracker.update(0.1, [
      subject("leader", 0, { passedCheckpoints: 2 }),
      subject("p3", -15),
      subject("p2", -12),
    ]).eliminatedPlayerIds).toEqual(["p3", "p2"]);
  });

  it("rejects invalid configuration and simulation input", () => {
    expect(() => new CameraEliminationTracker({ ...config, graceSeconds: -1 })).toThrow(/graceSeconds/);
    const tracker = new CameraEliminationTracker(config);
    expect(() => tracker.update(0, [])).toThrow(/stepSeconds/);
    expect(() => tracker.update(0.1, [subject("same", 0), subject("same", 1)])).toThrow(/duplicated/);
    expect(() => tracker.update(0.1, [{ ...subject("p1", 0), position: [NaN, 0, 0] }])).toThrow(/finite position/);
  });
});
