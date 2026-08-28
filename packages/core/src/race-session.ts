import {
  LapSession,
  type LapCourseDefinition,
  type LapProgress,
  type TrackVector3,
} from "./lap-session.js";
import { LOCAL_PLAYER_SLOTS } from "./local-roster.js";

export type RacePhase = "countdown" | "racing" | "finished";

export type RacePlayerStatus = "ready" | "racing" | "finished" | "eliminated";

export type RaceEliminationReason = "camera-distance" | "destroyed" | "retired";

export interface RacePlayerDefinition {
  id: string;
  displayName?: string;
}

export interface RaceSessionOptions {
  course: LapCourseDefinition;
  players: readonly RacePlayerDefinition[];
  totalLaps: number;
  countdownSeconds?: number;
}

export interface RacePlayerSnapshot {
  id: string;
  displayName: string;
  status: RacePlayerStatus;
  progress: LapProgress;
  finishTimeSeconds: number | null;
  eliminationReason: RaceEliminationReason | null;
}

export interface RaceResult {
  rank: number;
  playerId: string;
  displayName: string;
  status: "finished" | "eliminated";
  timeSeconds: number;
  completedLaps: number;
  passedCheckpoints: number;
  eliminationReason: RaceEliminationReason | null;
}

export interface RaceSnapshot {
  phase: RacePhase;
  countdownSecondsRemaining: number;
  elapsedRaceSeconds: number;
  totalLaps: number;
  players: readonly RacePlayerSnapshot[];
  results: readonly RaceResult[];
}

export type RaceEvent =
  | { type: "countdown-tick"; secondsRemaining: number }
  | { type: "race-started" }
  | { type: "checkpoint-passed"; playerId: string; checkpointId: number }
  | { type: "lap-completed"; playerId: string; completedLaps: number }
  | { type: "player-finished"; playerId: string; timeSeconds: number }
  | { type: "player-eliminated"; playerId: string; reason: RaceEliminationReason }
  | { type: "race-finished"; results: readonly RaceResult[] };

export type RacePlayerPositions = Readonly<Record<string, TrackVector3 | undefined>>;

interface RacePlayerRuntime {
  readonly definition: RacePlayerDefinition;
  readonly displayName: string;
  readonly lap: LapSession;
  status: RacePlayerStatus;
  previousPosition: TrackVector3 | undefined;
  finishTimeSeconds: number | undefined;
  eliminationTimeSeconds: number | undefined;
  eliminationReason: RaceEliminationReason | undefined;
  terminalOrder: number | undefined;
}

const MAX_LOCAL_PLAYERS = LOCAL_PLAYER_SLOTS.length;
const COUNTDOWN_EPSILON_SECONDS = 1e-9;

function validateFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

/**
 * Pure fixed-step race rules for one local match. Physics and presentation feed positions in and
 * consume plain events/snapshots, keeping the match reproducible in tests and future Workers.
 */
export class RaceSession {
  readonly #players: RacePlayerRuntime[];
  readonly #totalLaps: number;
  #phase: RacePhase;
  #countdownSecondsRemaining: number;
  #elapsedRaceSeconds = 0;
  #terminalOrder = 0;
  #results: readonly RaceResult[] = [];

  constructor(options: RaceSessionOptions) {
    if (options.players.length < 1 || options.players.length > MAX_LOCAL_PLAYERS) {
      throw new Error(`A race needs between 1 and ${MAX_LOCAL_PLAYERS} players`);
    }
    if (!Number.isInteger(options.totalLaps) || options.totalLaps < 1) {
      throw new Error("Race totalLaps must be a positive integer");
    }
    const countdownSeconds = options.countdownSeconds ?? 3;
    validateFiniteNonNegative(countdownSeconds, "Race countdownSeconds");

    const ids = new Set<string>();
    this.#players = options.players.map((definition) => {
      if (definition.id.length === 0 || ids.has(definition.id)) {
        throw new Error(`Race player id ${JSON.stringify(definition.id)} is empty or duplicated`);
      }
      ids.add(definition.id);
      return {
        definition,
        displayName: definition.displayName ?? definition.id,
        lap: new LapSession(options.course),
        status: countdownSeconds > 0 ? "ready" : "racing",
        previousPosition: undefined,
        finishTimeSeconds: undefined,
        eliminationTimeSeconds: undefined,
        eliminationReason: undefined,
        terminalOrder: undefined,
      };
    });
    this.#totalLaps = options.totalLaps;
    this.#countdownSecondsRemaining = countdownSeconds;
    this.#phase = countdownSeconds > 0 ? "countdown" : "racing";
  }

  get phase(): RacePhase {
    return this.#phase;
  }

  get snapshot(): RaceSnapshot {
    return {
      phase: this.#phase,
      countdownSecondsRemaining: this.#countdownSecondsRemaining,
      elapsedRaceSeconds: this.#elapsedRaceSeconds,
      totalLaps: this.#totalLaps,
      players: this.#players.map((player) => ({
        id: player.definition.id,
        displayName: player.displayName,
        status: player.status,
        progress: player.lap.progress,
        finishTimeSeconds: player.finishTimeSeconds ?? null,
        eliminationReason: player.eliminationReason ?? null,
      })),
      results: this.#results.map((result) => ({ ...result })),
    };
  }

  advance(stepSeconds: number, positions: RacePlayerPositions = {}): readonly RaceEvent[] {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new Error("Race stepSeconds must be a finite positive number");
    }
    if (this.#phase === "finished") {
      return [];
    }

    if (this.#phase === "countdown") {
      this.#rememberPositions(positions);
      const previousDisplayedSecond = Math.ceil(this.#countdownSecondsRemaining);
      const nextCountdown = this.#countdownSecondsRemaining - stepSeconds;
      this.#countdownSecondsRemaining = nextCountdown <= COUNTDOWN_EPSILON_SECONDS
        ? 0
        : nextCountdown;
      const nextDisplayedSecond = Math.ceil(this.#countdownSecondsRemaining);
      const events: RaceEvent[] = [];
      if (nextDisplayedSecond > 0 && nextDisplayedSecond < previousDisplayedSecond) {
        events.push({ type: "countdown-tick", secondsRemaining: nextDisplayedSecond });
      }
      if (this.#countdownSecondsRemaining === 0) {
        this.#phase = "racing";
        for (const player of this.#players) {
          if (player.status === "ready") {
            player.status = "racing";
          }
        }
        events.push({ type: "race-started" });
      }
      return events;
    }

    this.#elapsedRaceSeconds += stepSeconds;
    const events: RaceEvent[] = [];
    for (const player of this.#players) {
      if (player.status !== "racing") {
        continue;
      }
      const position = positions[player.definition.id];
      if (!position) {
        continue;
      }
      const update = player.lap.update(position, player.previousPosition ?? position);
      player.previousPosition = position;
      if (update.checkpointPassed !== null) {
        events.push({
          type: "checkpoint-passed",
          playerId: player.definition.id,
          checkpointId: update.checkpointPassed,
        });
      }
      if (!update.lapCompleted) {
        continue;
      }

      const completedLaps = player.lap.progress.completedLaps;
      events.push({ type: "lap-completed", playerId: player.definition.id, completedLaps });
      if (completedLaps >= this.#totalLaps) {
        player.status = "finished";
        player.finishTimeSeconds = this.#elapsedRaceSeconds;
        player.terminalOrder = this.#terminalOrder;
        this.#terminalOrder += 1;
        events.push({
          type: "player-finished",
          playerId: player.definition.id,
          timeSeconds: this.#elapsedRaceSeconds,
        });
      }
    }

    this.#finishIfTerminal(events);
    return events;
  }

  eliminatePlayer(playerId: string, reason: RaceEliminationReason): readonly RaceEvent[] {
    const player = this.#players.find((candidate) => candidate.definition.id === playerId);
    if (!player) {
      throw new Error(`Unknown race player ${playerId}`);
    }
    if (this.#phase !== "racing" || player.status !== "racing") {
      return [];
    }

    player.status = "eliminated";
    player.eliminationReason = reason;
    player.eliminationTimeSeconds = this.#elapsedRaceSeconds;
    player.terminalOrder = this.#terminalOrder;
    this.#terminalOrder += 1;
    const events: RaceEvent[] = [{ type: "player-eliminated", playerId, reason }];
    this.#finishIfTerminal(events);
    return events;
  }

  #rememberPositions(positions: RacePlayerPositions): void {
    for (const player of this.#players) {
      const position = positions[player.definition.id];
      if (position) {
        player.previousPosition = position;
      }
    }
  }

  #finishIfTerminal(events: RaceEvent[]): void {
    if (this.#players.some((player) => player.status === "ready" || player.status === "racing")) {
      return;
    }
    this.#phase = "finished";
    this.#results = this.#rankedResults();
    events.push({ type: "race-finished", results: this.#results.map((result) => ({ ...result })) });
  }

  #rankedResults(): readonly RaceResult[] {
    return [...this.#players]
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "finished" ? -1 : 1;
        }
        if (left.status === "finished") {
          return (left.finishTimeSeconds ?? Infinity) - (right.finishTimeSeconds ?? Infinity)
            || (left.terminalOrder ?? Infinity) - (right.terminalOrder ?? Infinity);
        }
        return (right.eliminationTimeSeconds ?? -Infinity) - (left.eliminationTimeSeconds ?? -Infinity)
          || (right.terminalOrder ?? -Infinity) - (left.terminalOrder ?? -Infinity);
      })
      .map((player, index) => ({
        rank: index + 1,
        playerId: player.definition.id,
        displayName: player.displayName,
        status: player.status === "finished" ? "finished" : "eliminated",
        timeSeconds: player.finishTimeSeconds ?? player.eliminationTimeSeconds ?? this.#elapsedRaceSeconds,
        completedLaps: player.lap.progress.completedLaps,
        passedCheckpoints: player.lap.progress.passedCheckpoints,
        eliminationReason: player.eliminationReason ?? null,
      }));
  }
}
