import type { LapCheckpoint, TrackVector3 } from "./lap-session.js";
import { SeededRandom } from "./random.js";

export type AiDifficulty = "easy" | "normal" | "hard";

export interface AiDifficultyProfile {
  reactionSeconds: number;
  minimumSpeedMetersPerSecond: number;
  maximumSpeedMetersPerSecond: number;
  steeringGain: number;
  brakingResponse: number;
  handbrakeHeadingRadians: number;
  laneWander: number;
  stuckSecondsBeforeEscape: number;
  escapeSeconds: number;
  itemDecisionSeconds: number;
  itemUseChance: number;
}

export const AI_DIFFICULTY_PROFILES: Readonly<Record<AiDifficulty, Readonly<AiDifficultyProfile>>> =
  Object.freeze({
    easy: Object.freeze({
      reactionSeconds: 0.2,
      minimumSpeedMetersPerSecond: 2.5,
      maximumSpeedMetersPerSecond: 7,
      steeringGain: 1.25,
      brakingResponse: 3,
      handbrakeHeadingRadians: 1.05,
      laneWander: 0.32,
      stuckSecondsBeforeEscape: 4.5,
      escapeSeconds: 1.6,
      itemDecisionSeconds: 2.5,
      itemUseChance: 0.25,
    }),
    normal: Object.freeze({
      reactionSeconds: 0.1,
      minimumSpeedMetersPerSecond: 3,
      maximumSpeedMetersPerSecond: 9,
      steeringGain: 1.55,
      brakingResponse: 3.5,
      handbrakeHeadingRadians: 0.88,
      laneWander: 0.18,
      stuckSecondsBeforeEscape: 3.75,
      escapeSeconds: 1.4,
      itemDecisionSeconds: 1.75,
      itemUseChance: 0.45,
    }),
    hard: Object.freeze({
      reactionSeconds: 1 / 60,
      minimumSpeedMetersPerSecond: 3.5,
      maximumSpeedMetersPerSecond: 11,
      steeringGain: 1.8,
      brakingResponse: 4,
      handbrakeHeadingRadians: 0.72,
      laneWander: 0.08,
      stuckSecondsBeforeEscape: 3,
      escapeSeconds: 1.2,
      itemDecisionSeconds: 1.25,
      itemUseChance: 0.65,
    }),
  });

export interface AiRouteDriverState {
  position: TrackVector3;
  headingRadians: number;
  speedMetersPerSecond: number;
  precedingCheckpoint: LapCheckpoint;
  checkpoint: LapCheckpoint;
  followingCheckpoint: LapCheckpoint;
}

export interface AiVehicleInput {
  drive: number;
  steer: number;
  brake: number;
  handbrake: number;
  recover: boolean;
  useItem: boolean;
}

export interface AiRouteDriverOptions {
  difficulty?: AiDifficulty;
  seed: number;
}

export interface AiRouteDriverSnapshot {
  difficulty: AiDifficulty;
  randomState: number;
  elapsedSeconds: number;
  stuckSeconds: number;
  escapeSecondsRemaining: number;
  targetCheckpointId: number | null;
  laneBias: number;
  input: AiVehicleInput;
}

const NEUTRAL_INPUT: Readonly<AiVehicleInput> = Object.freeze({
  drive: 0,
  steer: 0,
  brake: 0,
  handbrake: 0,
  recover: false,
  useItem: false,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function headingBetween(start: TrackVector3, finish: TrackVector3): number {
  return Math.atan2(finish[0] - start[0], finish[2] - start[2]);
}

function assertFiniteState(state: AiRouteDriverState): void {
  for (const [name, value] of [
    ["position.x", state.position[0]],
    ["position.y", state.position[1]],
    ["position.z", state.position[2]],
    ["headingRadians", state.headingRadians],
    ["speedMetersPerSecond", state.speedMetersPerSecond],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new Error(`AI route driver ${name} must be finite`);
    }
  }
  if (state.speedMetersPerSecond < 0) {
    throw new Error("AI route driver speedMetersPerSecond cannot be negative");
  }
}

function checkpointTarget(checkpoint: LapCheckpoint, bias: number): TrackVector3 {
  const points = checkpoint.triangles.flatMap((triangle) => triangle);
  let first = points[0] ?? checkpoint.center;
  let second = first;
  let maximumDistance = 0;
  for (const start of points) {
    for (const finish of points) {
      const distance = Math.hypot(finish[0] - start[0], finish[2] - start[2]);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        first = start;
        second = finish;
      }
    }
  }
  return [
    checkpoint.center[0] + (second[0] - first[0]) * bias,
    checkpoint.center[1],
    checkpoint.center[2] + (second[2] - first[2]) * bias,
  ];
}

/** Deterministic fixed-step driver that turns ordered checkpoint geometry into normal vehicle input. */
export class AiRouteDriver {
  readonly #difficulty: AiDifficulty;
  readonly #profile: Readonly<AiDifficultyProfile>;
  readonly #random: SeededRandom;
  readonly #initialRandomState: number;
  #elapsedSeconds = 0;
  #decisionSeconds = 0;
  #itemDecisionSeconds = 0;
  #stuckSeconds = 0;
  #escapeSecondsRemaining = 0;
  #escapeSteer = 0;
  #targetCheckpointId: number | undefined;
  #laneBias = 0;
  #input: AiVehicleInput = { ...NEUTRAL_INPUT };

  constructor(options: AiRouteDriverOptions) {
    this.#difficulty = options.difficulty ?? "normal";
    this.#profile = AI_DIFFICULTY_PROFILES[this.#difficulty];
    this.#random = new SeededRandom(options.seed);
    this.#initialRandomState = this.#random.state;
  }

  get snapshot(): AiRouteDriverSnapshot {
    return {
      difficulty: this.#difficulty,
      randomState: this.#random.state,
      elapsedSeconds: this.#elapsedSeconds,
      stuckSeconds: this.#stuckSeconds,
      escapeSecondsRemaining: this.#escapeSecondsRemaining,
      targetCheckpointId: this.#targetCheckpointId ?? null,
      laneBias: this.#laneBias,
      input: { ...this.#input },
    };
  }

  reset(): void {
    this.#random.restore(this.#initialRandomState);
    this.#elapsedSeconds = 0;
    this.#decisionSeconds = 0;
    this.#itemDecisionSeconds = 0;
    this.#stuckSeconds = 0;
    this.#escapeSecondsRemaining = 0;
    this.#escapeSteer = 0;
    this.#targetCheckpointId = undefined;
    this.#laneBias = 0;
    this.#input = { ...NEUTRAL_INPUT };
  }

  advance(stepSeconds: number, state: AiRouteDriverState): AiVehicleInput {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new Error("AI route driver stepSeconds must be a finite positive number");
    }
    assertFiniteState(state);
    this.#elapsedSeconds += stepSeconds;
    this.#decisionSeconds += stepSeconds;
    this.#itemDecisionSeconds += stepSeconds;

    const distanceToCheckpoint = Math.hypot(
      state.checkpoint.center[0] - state.position[0],
      state.checkpoint.center[2] - state.position[2],
    );
    this.#stuckSeconds = state.speedMetersPerSecond < 0.6 && distanceToCheckpoint > 3
      ? this.#stuckSeconds + stepSeconds
      : 0;
    if (
      this.#escapeSecondsRemaining <= 0
      && this.#stuckSeconds + 1e-9 >= this.#profile.stuckSecondsBeforeEscape
    ) {
      this.#escapeSecondsRemaining = this.#profile.escapeSeconds;
      this.#escapeSteer = this.#random.nextFloat() < 0.5 ? -0.45 : 0.45;
      this.#stuckSeconds = 0;
    }
    if (this.#escapeSecondsRemaining > 0) {
      this.#escapeSecondsRemaining = Math.max(0, this.#escapeSecondsRemaining - stepSeconds);
      this.#input = {
        drive: -0.75,
        steer: this.#escapeSteer,
        brake: 0,
        handbrake: 0,
        recover: false,
        useItem: false,
      };
      return { ...this.#input };
    }

    if (state.checkpoint.id !== this.#targetCheckpointId) {
      this.#targetCheckpointId = state.checkpoint.id;
      this.#laneBias = this.#random.range(-this.#profile.laneWander, this.#profile.laneWander);
      this.#decisionSeconds = this.#profile.reactionSeconds;
    }

    let useItem = false;
    if (this.#itemDecisionSeconds + 1e-9 >= this.#profile.itemDecisionSeconds) {
      this.#itemDecisionSeconds %= this.#profile.itemDecisionSeconds;
      useItem = this.#random.nextFloat() < this.#profile.itemUseChance;
    }
    if (this.#decisionSeconds + 1e-9 >= this.#profile.reactionSeconds) {
      this.#decisionSeconds %= this.#profile.reactionSeconds;
      this.#input = this.#routeDecision(state);
    }
    return { ...this.#input, useItem };
  }

  #routeDecision(state: AiRouteDriverState): AiVehicleInput {
    const target = checkpointTarget(state.checkpoint, this.#laneBias);
    const targetHeading = headingBetween(state.position, target);
    const entryHeading = headingBetween(
      state.precedingCheckpoint.center,
      state.checkpoint.center,
    );
    const exitHeading = headingBetween(state.checkpoint.center, state.followingCheckpoint.center);
    const headingError = wrapRadians(targetHeading - state.headingRadians);
    const cornerAngle = Math.abs(wrapRadians(exitHeading - entryHeading));
    const severity = Math.max(
      clamp(Math.abs(headingError) / 1.25, 0, 1),
      clamp(cornerAngle / 1.4, 0, 1),
    );
    const targetSpeed = this.#profile.minimumSpeedMetersPerSecond
      + (this.#profile.maximumSpeedMetersPerSecond - this.#profile.minimumSpeedMetersPerSecond)
        * (1 - severity);
    const overspeed = state.speedMetersPerSecond - targetSpeed;
    const brake = overspeed > 0.6
      ? clamp(overspeed / this.#profile.brakingResponse, 0, 1)
      : 0;
    return {
      drive: brake > 0 ? 0 : state.speedMetersPerSecond < targetSpeed ? 1 : 0.2,
      steer: clamp(-headingError * this.#profile.steeringGain, -1, 1),
      brake,
      handbrake: Math.abs(headingError) > this.#profile.handbrakeHeadingRadians
        && state.speedMetersPerSecond > 6 ? 0.25 : 0,
      recover: false,
      useItem: false,
    };
  }
}
