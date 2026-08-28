import { describe, expect, it } from "vitest";

import { runStageFiveSoak } from "../src/index.js";

describe("Stage 5 soak invariants", () => {
  it("survives repeated complete-match resets with bounded runtime state", () => {
    const report = runStageFiveSoak({ simulatedSeconds: 30 });
    expect(report.simulatedSeconds).toBeGreaterThanOrEqual(30);
    expect(report.matches).toBeGreaterThan(10);
    expect(report.maximumProjectiles).toBeGreaterThan(1);
    expect(report.maximumProjectiles).toBeLessThanOrEqual(12);
    expect(report.maximumConcurrentParticles).toBeLessThanOrEqual(128);
    expect(report.deterministicResets).toBe(true);
    expect(report.finiteSnapshots).toBe(true);
    expect(report.legalStateTransitions).toBe(true);
  });
});

