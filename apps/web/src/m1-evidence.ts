import type { RuntimeState } from "@mashed/core";

export interface M1EvidenceSample {
  timestampMilliseconds: number;
  frameMilliseconds: number;
  physicsMilliseconds: number;
  fps: number;
  simulationStep: number;
  droppedSeconds: number;
  activeVehicles: number;
  bodies: number;
  colliders: number;
  contacts: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  sceneObjects: number;
  combatPickups: number;
  combatProjectiles: number;
  burstEffects: number;
  particles: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
}

export interface M1EvidenceContext {
  state: RuntimeState;
  playerCount: number;
  loadedAssetCount: number;
  windowWidth: number;
  windowHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  networkRequestsAfterReset: readonly {
    name: string;
    initiatorType: string;
    transferSize: number;
  }[];
}

export interface M1EvidenceReport extends M1EvidenceContext {
  version: 1;
  sampleCount: number;
  durationSeconds: number;
  frameMilliseconds: { median: number; p95: number; maximum: number };
  physicsMilliseconds: { median: number; p95: number; maximum: number };
  fps: { median: number; p05: number; minimum: number };
  simulationSteps: number;
  droppedSeconds: number;
  maximumActiveVehicles: number;
  maximumBodies: number;
  maximumColliders: number;
  maximumContacts: number;
  maximumDrawCalls: number;
  maximumTriangles: number;
  maximumGeometries: number;
  maximumTextures: number;
  maximumSceneObjects: number;
  maximumCombatPickups: number;
  maximumCombatProjectiles: number;
  maximumBurstEffects: number;
  maximumParticles: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
}

export interface M1EvidenceAcceptance {
  enoughSamples: boolean;
  fourPlayersActive: boolean;
  preparedAssetsLoaded: boolean;
  atLeast1080p: boolean;
  sixtyFps: boolean;
  noDroppedSimulationTime: boolean;
  offlineAfterInitialLoad: boolean;
  passed: boolean;
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)] ?? 0;
}

function maximum(samples: readonly M1EvidenceSample[], select: (sample: M1EvidenceSample) => number): number {
  return samples.reduce((result, sample) => Math.max(result, select(sample)), 0);
}

/** Bounded frame sampler exposed only by the explicit M1 evidence query mode. */
export class M1EvidenceCollector {
  readonly #maximumSamples: number;
  readonly #samples: M1EvidenceSample[] = [];

  constructor(maximumSamples = 7_200) {
    if (!Number.isInteger(maximumSamples) || maximumSamples < 1) {
      throw new Error("M1 evidence maximumSamples must be a positive integer");
    }
    this.#maximumSamples = maximumSamples;
  }

  reset(): void {
    this.#samples.length = 0;
  }

  record(sample: M1EvidenceSample): void {
    if (sample.frameMilliseconds <= 0) {
      return;
    }
    this.#samples.push(structuredClone(sample));
    if (this.#samples.length > this.#maximumSamples) {
      this.#samples.splice(0, this.#samples.length - this.#maximumSamples);
    }
  }

  report(context: M1EvidenceContext): M1EvidenceReport {
    const samples = this.#samples;
    const first = samples[0];
    const last = samples.at(-1);
    const frameMilliseconds = samples.map((sample) => sample.frameMilliseconds);
    const physicsMilliseconds = samples.map((sample) => sample.physicsMilliseconds);
    const fps = samples.map((sample) => sample.fps);
    return {
      version: 1,
      ...structuredClone(context),
      sampleCount: samples.length,
      durationSeconds: first && last
        ? Math.max(0, (last.timestampMilliseconds - first.timestampMilliseconds) / 1000)
        : 0,
      frameMilliseconds: {
        median: percentile(frameMilliseconds, 0.5),
        p95: percentile(frameMilliseconds, 0.95),
        maximum: maximum(samples, (sample) => sample.frameMilliseconds),
      },
      physicsMilliseconds: {
        median: percentile(physicsMilliseconds, 0.5),
        p95: percentile(physicsMilliseconds, 0.95),
        maximum: maximum(samples, (sample) => sample.physicsMilliseconds),
      },
      fps: {
        median: percentile(fps, 0.5),
        p05: percentile(fps, 0.05),
        minimum: samples.length > 0
          ? samples.reduce((result, sample) => Math.min(result, sample.fps), Infinity)
          : 0,
      },
      simulationSteps: first && last ? Math.max(0, last.simulationStep - first.simulationStep) : 0,
      droppedSeconds: last?.droppedSeconds ?? 0,
      maximumActiveVehicles: maximum(samples, (sample) => sample.activeVehicles),
      maximumBodies: maximum(samples, (sample) => sample.bodies),
      maximumColliders: maximum(samples, (sample) => sample.colliders),
      maximumContacts: maximum(samples, (sample) => sample.contacts),
      maximumDrawCalls: maximum(samples, (sample) => sample.drawCalls),
      maximumTriangles: maximum(samples, (sample) => sample.triangles),
      maximumGeometries: maximum(samples, (sample) => sample.geometries),
      maximumTextures: maximum(samples, (sample) => sample.textures),
      maximumSceneObjects: maximum(samples, (sample) => sample.sceneObjects),
      maximumCombatPickups: maximum(samples, (sample) => sample.combatPickups),
      maximumCombatProjectiles: maximum(samples, (sample) => sample.combatProjectiles),
      maximumBurstEffects: maximum(samples, (sample) => sample.burstEffects),
      maximumParticles: maximum(samples, (sample) => sample.particles),
      drawingBufferWidth: last?.drawingBufferWidth ?? 0,
      drawingBufferHeight: last?.drawingBufferHeight ?? 0,
    };
  }
}

export function evaluateM1Evidence(report: M1EvidenceReport): M1EvidenceAcceptance {
  const result = {
    enoughSamples: report.sampleCount >= 300 && report.durationSeconds >= 5,
    fourPlayersActive: report.playerCount === 4 && report.maximumActiveVehicles === 4,
    preparedAssetsLoaded: report.loadedAssetCount > 0,
    atLeast1080p: report.drawingBufferWidth >= 1920 && report.drawingBufferHeight >= 1080,
    sixtyFps: report.fps.median >= 59 && report.frameMilliseconds.p95 <= 20,
    noDroppedSimulationTime: report.droppedSeconds === 0,
    offlineAfterInitialLoad: report.networkRequestsAfterReset.length === 0,
  };
  return { ...result, passed: Object.values(result).every(Boolean) };
}
