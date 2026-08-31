import { describe, expect, it } from "vitest";
import type { AiRouteDriverState, LapCheckpoint } from "@mashed/core";
import { probeAiNavigation } from "../src/ai-navigation.js";

function checkpoint(id: number, z: number): LapCheckpoint {
  return { id, center: [0, 1, z], triangles: [[[-3, 0, z], [3, 0, z], [0, 2, z]]] };
}
const state: AiRouteDriverState = {
  position: [0, 0.8, 0], headingRadians: 0, speedMetersPerSecond: 2,
  precedingCheckpoint: checkpoint(0, -5), checkpoint: checkpoint(1, 5), followingCheckpoint: checkpoint(2, 10),
};

describe("AI collision feelers", () => {
  it("casts three bounded chassis-width rays per lane and reports a blocking wall", () => {
    let rays = 0;
    const targets = probeAiNavigation({ castProjectileSegment(start, end) {
      rays += 1;
      expect(start[1]).toBe(0.8);
      expect(end[1]).toBe(start[1]);
      expect(Math.hypot(end[0] - start[0], end[2] - start[2])).toBeLessThanOrEqual(8);
      return { fraction: 0.25, normal: [0, 0, -1] };
    } }, state);
    expect(rays).toBe(15);
    expect(targets).toHaveLength(5);
    expect(targets.every((target) => target.clearance === 0.25)).toBe(true);
  });
  it("does not mistake an upward road slope for a blocking wall", () => {
    const targets = probeAiNavigation({ castProjectileSegment() {
      return { fraction: 0.1, normal: [0, 0.9, 0.1] };
    } }, state);
    expect(targets.every((target) => target.clearance === 1)).toBe(true);
  });
});
