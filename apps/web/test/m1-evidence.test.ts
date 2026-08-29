import { describe, expect, it } from "vitest";

import {
  evaluateM1Evidence,
  M1EvidenceCollector,
  type M1EvidenceSample,
} from "../src/m1-evidence.js";

function sample(index: number): M1EvidenceSample {
  return {
    timestampMilliseconds: index * 16,
    frameMilliseconds: 10 + index,
    physicsMilliseconds: index / 10,
    fps: 70 - index,
    simulationStep: 100 + index,
    droppedSeconds: 0,
    activeVehicles: 4,
    bodies: 10,
    colliders: 20,
    contacts: index,
    drawCalls: 18,
    triangles: 4_000,
    geometries: 12,
    textures: 3,
    sceneObjects: 7,
    combatPickups: 3,
    combatProjectiles: index,
    burstEffects: 2,
    particles: 36,
    drawingBufferWidth: 1920,
    drawingBufferHeight: 1080,
  };
}

describe("M1EvidenceCollector", () => {
  it("reports percentiles, resource peaks, resolution, and bounded sample retention", () => {
    const collector = new M1EvidenceCollector(5);
    for (let index = 0; index < 8; index += 1) {
      collector.record(sample(index));
    }
    const report = collector.report({
      state: "race",
      playerCount: 4,
      loadedAssetCount: 7,
      windowWidth: 1920,
      windowHeight: 1080,
      viewportWidth: 1920,
      viewportHeight: 1080,
      devicePixelRatio: 1,
      networkRequestsAfterReset: [],
    });

    expect(report.sampleCount).toBe(5);
    expect(report.durationSeconds).toBeCloseTo(0.064);
    expect(report.frameMilliseconds).toEqual({ median: 15, p95: 16, maximum: 17 });
    expect(report.physicsMilliseconds).toEqual({ median: 0.5, p95: 0.6, maximum: 0.7 });
    expect(report.fps).toEqual({ median: 65, p05: 63, minimum: 63 });
    expect(report.simulationSteps).toBe(4);
    expect(report.maximumActiveVehicles).toBe(4);
    expect(report.maximumCombatProjectiles).toBe(7);
    expect([report.drawingBufferWidth, report.drawingBufferHeight]).toEqual([1920, 1080]);
  });

  it("ignores zero-length frames and resets cleanly", () => {
    const collector = new M1EvidenceCollector();
    collector.record({ ...sample(0), frameMilliseconds: 0 });
    collector.record(sample(1));
    collector.reset();
    expect(collector.report({
      state: "menu",
      playerCount: 1,
      loadedAssetCount: 0,
      windowWidth: 1,
      windowHeight: 1,
      viewportWidth: 1,
      viewportHeight: 1,
      devicePixelRatio: 1,
      networkRequestsAfterReset: [],
    }).sampleCount).toBe(0);
  });

  it("evaluates the explicit four-player, 1080p, 60 fps, and offline gate", () => {
    const collector = new M1EvidenceCollector();
    for (let index = 0; index < 360; index += 1) {
      collector.record({
        ...sample(index),
        timestampMilliseconds: index * (1000 / 60),
        frameMilliseconds: 1000 / 60,
        physicsMilliseconds: 0.8,
        fps: 60,
        droppedSeconds: 0,
      });
    }
    const report = collector.report({
      state: "race",
      playerCount: 4,
      loadedAssetCount: 7,
      windowWidth: 1920,
      windowHeight: 1080,
      viewportWidth: 1920,
      viewportHeight: 1080,
      devicePixelRatio: 1,
      networkRequestsAfterReset: [],
    });
    const acceptance = evaluateM1Evidence(report);
    expect(acceptance).toEqual({
      enoughSamples: true,
      fourPlayersActive: true,
      preparedAssetsLoaded: true,
      atLeast1080p: true,
      sixtyFps: true,
      noDroppedSimulationTime: true,
      offlineAfterInitialLoad: true,
      passed: true,
    });
    expect(evaluateM1Evidence({ ...report, loadedAssetCount: 0 })).toMatchObject({
      preparedAssetsLoaded: false,
      passed: false,
    });
  });
});
