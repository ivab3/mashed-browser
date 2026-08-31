import type { LapCheckpoint, TrackVector3 } from "./lap-session.js";
import { COMBAT_WEAPON_CONFIGS, type CombatWeaponType } from "./combat-session.js";
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
  tacticalRangeScale: number;
  tacticalConeRadians: number;
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
      tacticalRangeScale: 0.72,
      tacticalConeRadians: 0.35,
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
      tacticalRangeScale: 0.88,
      tacticalConeRadians: 0.55,
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
      tacticalRangeScale: 1,
      tacticalConeRadians: 0.8,
    }),
  });

export interface AiRouteDriverState {
  position: TrackVector3;
  headingRadians: number;
  speedMetersPerSecond: number;
  precedingCheckpoint: LapCheckpoint;
  checkpoint: LapCheckpoint;
  followingCheckpoint: LapCheckpoint;
  heldWeapon?: CombatWeaponType;
  opponents?: readonly AiOpponentState[];
  navigationTargets?: readonly AiNavigationTarget[];
}

export interface AiNavigationTarget {
  position: TrackVector3;
  bias: number;
  clearance: number;
}

export interface AiOpponentState {
  id: string;
  position: TrackVector3;
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
  targetPlayerId: string | null;
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
  const opponentIds = new Set<string>();
  for (const target of state.navigationTargets ?? []) {
    if (target.position.some((value) => !Number.isFinite(value))
      || !Number.isFinite(target.bias) || !Number.isFinite(target.clearance)
      || target.clearance < 0 || target.clearance > 1) {
      throw new Error("AI navigation target must contain finite coordinates and clearance in [0, 1]");
    }
  }
  for (const opponent of state.opponents ?? []) {
    if (!opponent.id || opponentIds.has(opponent.id)) {
      throw new Error(`AI route driver opponent id ${JSON.stringify(opponent.id)} is empty or duplicated`);
    }
    opponentIds.add(opponent.id);
    if (opponent.position.some((value) => !Number.isFinite(value))) {
      throw new Error(`AI route driver opponent ${opponent.id} position must be finite`);
    }
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

function routeTarget(state: AiRouteDriverState, bias: number): TrackVector3 {
  const target = checkpointTarget(state.checkpoint, bias);
  const dx = state.followingCheckpoint.center[0] - state.checkpoint.center[0];
  const dz = state.followingCheckpoint.center[2] - state.checkpoint.center[2];
  const length = Math.hypot(dx, dz);
  const beyondCheckpoint = (state.position[0] - state.checkpoint.center[0]) * dx
    + (state.position[2] - state.checkpoint.center[2]) * dz > length * 0.3;
  const lookAhead = Math.min(0.9, length * 0.25) * (beyondCheckpoint ? -1 : 1);
  return length < 1e-5 ? target : [
    target[0] + dx / length * lookAhead, target[1], target[2] + dz / length * lookAhead,
  ];
}

/** Candidate positions stay within the authored checkpoint width, with a short crossing target. */
export function createAiNavigationTargets(
  state: AiRouteDriverState,
): readonly Omit<AiNavigationTarget, "clearance">[] {
  const left = checkpointTarget(state.checkpoint, -0.5);
  const right = checkpointTarget(state.checkpoint, 0.5);
  // A chassis plus steering margin leaves no safe alternate lane in the narrowest gates.
  if (Math.hypot(right[0] - left[0], right[2] - left[2]) < 2.5) {
    return [];
  }
  return [0, -0.2, 0.2, -0.4, 0.4].map((bias) => ({ bias, position: routeTarget(state, bias) }));
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
  #targetPlayerId: string | undefined;
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
      targetPlayerId: this.#targetPlayerId ?? null,
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
    this.#targetPlayerId = undefined;
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
    const targetError = wrapRadians(
      headingBetween(state.position, routeTarget(state, this.#laneBias)) - state.headingRadians,
    );

    this.#stuckSeconds = state.speedMetersPerSecond < 0.6
      ? this.#stuckSeconds + stepSeconds
      : 0;
    if (
      this.#escapeSecondsRemaining <= 0
      && this.#stuckSeconds + 1e-9 >= this.#profile.stuckSecondsBeforeEscape
    ) {
      this.#escapeSecondsRemaining = this.#profile.escapeSeconds;
      this.#escapeSteer = clamp(targetError, -1, 1);
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

    const tacticalTarget = state.heldWeapon
      ? selectAiWeaponTarget({
          position: state.position,
          headingRadians: state.headingRadians,
          weapon: state.heldWeapon,
          opponents: state.opponents ?? [],
          difficulty: this.#difficulty,
        })
      : undefined;
    this.#targetPlayerId = tacticalTarget?.id;

    let useItem = false;
    if (this.#itemDecisionSeconds + 1e-9 >= this.#profile.itemDecisionSeconds) {
      this.#itemDecisionSeconds %= this.#profile.itemDecisionSeconds;
      useItem = tacticalTarget !== undefined && this.#random.nextFloat() < this.#profile.itemUseChance;
    }
    if (this.#decisionSeconds + 1e-9 >= this.#profile.reactionSeconds) {
      this.#decisionSeconds %= this.#profile.reactionSeconds;
      this.#input = this.#routeDecision(state);
    }
    return { ...this.#input, useItem };
  }

  #routeDecision(state: AiRouteDriverState): AiVehicleInput {
    const candidates = state.navigationTargets;
    const target = candidates?.length
      ? [...candidates].sort((left, right) => (
          right.clearance - left.clearance
          || Math.abs(left.bias - this.#laneBias) - Math.abs(right.bias - this.#laneBias)
        ))[0]!.position
      : routeTarget(state, this.#laneBias);
    const targetHeading = headingBetween(state.position, target);
    const entryHeading = headingBetween(
      state.precedingCheckpoint.center,
      state.checkpoint.center,
    );
    const exitHeading = headingBetween(state.checkpoint.center, state.followingCheckpoint.center);
    const headingError = wrapRadians(targetHeading - state.headingRadians);
    if (Math.abs(headingError) > 2.1) {
      return {
        drive: -0.65,
        steer: clamp(wrapRadians(headingError + Math.PI) * this.#profile.steeringGain, -1, 1),
        brake: state.speedMetersPerSecond > 3 ? 0.5 : 0,
        handbrake: 0,
        recover: false,
        useItem: false,
      };
    }
    const cornerAngle = Math.abs(wrapRadians(exitHeading - entryHeading));
    const severity = Math.max(
      clamp(Math.abs(headingError) / 1.25, 0, 1),
      clamp(cornerAngle / 1.4, 0, 1),
    );
    const segmentLength = Math.min(
      Math.hypot(
        state.checkpoint.center[0] - state.precedingCheckpoint.center[0],
        state.checkpoint.center[2] - state.precedingCheckpoint.center[2],
      ),
      Math.hypot(
        state.followingCheckpoint.center[0] - state.checkpoint.center[0],
        state.followingCheckpoint.center[2] - state.checkpoint.center[2],
      ),
    );
    const cornerSpeedLimit = Math.sqrt(Math.max(1, segmentLength / Math.max(0.01, cornerAngle)) * 5);
    const targetSpeed = Math.min(cornerSpeedLimit, this.#profile.minimumSpeedMetersPerSecond
      + (this.#profile.maximumSpeedMetersPerSecond - this.#profile.minimumSpeedMetersPerSecond)
        * (1 - severity));
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

const AI_WEAPON_RANGES: Readonly<Record<CombatWeaponType, number>> = Object.freeze({
  "machine-gun": 18,
  "guided-missile": 34,
  mortar: 28,
  "rear-flame": 8,
  oil: 10,
  "proximity-mine": 11,
  "drum-bomb": 16,
  shotgun: 7,
  flash: 11,
  rocket: 34,
  mine: 11,
});

export interface AiWeaponTargetContext {
  position: TrackVector3;
  headingRadians: number;
  weapon: CombatWeaponType;
  opponents: readonly AiOpponentState[];
  difficulty?: AiDifficulty;
}

/** Selects the nearest opponent inside the held weapon's useful delivery arc and range. */
export function selectAiWeaponTarget(context: AiWeaponTargetContext): AiOpponentState | undefined {
  const profile = AI_DIFFICULTY_PROFILES[context.difficulty ?? "normal"];
  const config = COMBAT_WEAPON_CONFIGS[context.weapon];
  const range = AI_WEAPON_RANGES[context.weapon] * profile.tacticalRangeScale;
  const cone = profile.tacticalConeRadians * (
    context.weapon === "guided-missile" || context.weapon === "rocket" ? 1.45 : 1
  );
  return context.opponents
    .map((opponent) => {
      const deltaX = opponent.position[0] - context.position[0];
      const deltaZ = opponent.position[2] - context.position[2];
      const distance = Math.hypot(deltaX, deltaZ);
      const bearing = wrapRadians(Math.atan2(deltaX, deltaZ) - context.headingRadians);
      const inArc = config.delivery === "radial"
        || (config.delivery === "forward" && Math.abs(bearing) <= cone)
        || ((config.delivery === "rear" || config.delivery === "rear-hazard")
          && Math.abs(wrapRadians(bearing - Math.PI)) <= cone * 1.25);
      return { opponent, distance, inArc };
    })
    .filter((candidate) => candidate.inArc && candidate.distance <= range)
    .sort((left, right) => left.distance - right.distance)[0]?.opponent;
}
