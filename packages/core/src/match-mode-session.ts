import { LOCAL_PLAYER_SLOTS } from "./local-roster.js";

export type MatchModeType = "standard" | "team" | "hold-the-flag" | "fugitive";
export type MatchModePhase = "playing" | "round-complete" | "finished";

export interface MatchModePlayerDefinition {
  id: string;
  displayName?: string;
  teamId?: string;
}

export interface MatchModeSessionOptions {
  mode: MatchModeType;
  players: readonly MatchModePlayerDefinition[];
  pointsToWin?: number;
  flagHoldSeconds?: number;
  fugitiveSurvivalSeconds?: number;
}

export interface MatchModeFrame {
  activePlayerIds: readonly string[];
  flagCapturePlayerId?: string;
  completedLapPlayerIds?: readonly string[];
  fugitiveEliminatedByPlayerId?: string;
}

export interface MatchModePlayerSnapshot {
  id: string;
  displayName: string;
  teamId: string | null;
  score: number;
}

export interface MatchModeTeamSnapshot {
  id: string;
  score: number;
  playerIds: readonly string[];
}

export interface MatchModeSnapshot {
  mode: MatchModeType;
  phase: MatchModePhase;
  round: number;
  elapsedSeconds: number;
  roundElapsedSeconds: number;
  pointsToWin: number;
  players: readonly MatchModePlayerSnapshot[];
  teams: readonly MatchModeTeamSnapshot[];
  flagHolderId: string | null;
  flagHoldSeconds: number;
  flagHoldTargetSeconds: number;
  fugitiveId: string | null;
  fugitiveSurvivalTargetSeconds: number;
  roundWinnerIds: readonly string[];
  matchWinnerIds: readonly string[];
}

export type MatchModeEvent =
  | { type: "flag-captured"; playerId: string }
  | { type: "flag-dropped"; playerId: string }
  | { type: "fugitive-assigned"; playerId: string; round: number }
  | { type: "score-awarded"; playerIds: readonly string[]; teamId?: string; score: number }
  | {
      type: "round-completed";
      round: number;
      winnerIds: readonly string[];
      reason:
        | "last-player"
        | "last-team"
        | "flag-held"
        | "fugitive-survived"
        | "fugitive-intercepted"
        | "no-survivors";
    }
  | { type: "match-completed"; winnerIds: readonly string[]; score: number };

interface MatchModePlayerRuntime {
  readonly definition: MatchModePlayerDefinition;
  readonly displayName: string;
  score: number;
}

interface MatchModeTeamRuntime {
  readonly id: string;
  readonly playerIds: readonly string[];
  score: number;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
  return value;
}

/** Pure multi-round policy for the four original local-match rule families. */
export class MatchModeSession {
  readonly #mode: MatchModeType;
  readonly #players: MatchModePlayerRuntime[];
  readonly #teams: MatchModeTeamRuntime[];
  readonly #pointsToWin: number;
  readonly #flagHoldTargetSeconds: number;
  readonly #fugitiveSurvivalTargetSeconds: number;
  #phase: MatchModePhase = "playing";
  #round = 1;
  #elapsedSeconds = 0;
  #roundElapsedSeconds = 0;
  #flagHolderId: string | undefined;
  #flagHoldSeconds = 0;
  #fugitiveIndex = 0;
  #roundWinnerIds: readonly string[] = [];
  #matchWinnerIds: readonly string[] = [];

  constructor(options: MatchModeSessionOptions) {
    if (options.players.length < 2 || options.players.length > LOCAL_PLAYER_SLOTS.length) {
      throw new Error(`Match mode needs between 2 and ${LOCAL_PLAYER_SLOTS.length} players`);
    }
    this.#mode = options.mode;
    this.#pointsToWin = positiveFinite(options.pointsToWin ?? 8, "pointsToWin");
    if (!Number.isInteger(this.#pointsToWin)) {
      throw new Error("pointsToWin must be an integer");
    }
    this.#flagHoldTargetSeconds = positiveFinite(options.flagHoldSeconds ?? 12, "flagHoldSeconds");
    this.#fugitiveSurvivalTargetSeconds = positiveFinite(
      options.fugitiveSurvivalSeconds ?? 45,
      "fugitiveSurvivalSeconds",
    );

    const ids = new Set<string>();
    this.#players = options.players.map((definition) => {
      if (!definition.id || ids.has(definition.id)) {
        throw new Error(`Match mode player id ${JSON.stringify(definition.id)} is empty or duplicated`);
      }
      ids.add(definition.id);
      return {
        definition,
        displayName: definition.displayName ?? definition.id,
        score: 0,
      };
    });

    const teamPlayers = new Map<string, string[]>();
    for (const player of this.#players) {
      if (player.definition.teamId) {
        const members = teamPlayers.get(player.definition.teamId) ?? [];
        members.push(player.definition.id);
        teamPlayers.set(player.definition.teamId, members);
      }
    }
    this.#teams = [...teamPlayers].map(([id, playerIds]) => ({ id, playerIds, score: 0 }));
    if (this.#mode === "team") {
      if (this.#teams.length !== 2 || this.#teams.some((team) => team.playerIds.length < 1)) {
        throw new Error("Team Play requires exactly two non-empty teams");
      }
      if (this.#players.some((player) => !player.definition.teamId)) {
        throw new Error("Every Team Play player must belong to a team");
      }
    }
  }

  get snapshot(): MatchModeSnapshot {
    const fugitive = this.#mode === "fugitive" ? this.#players[this.#fugitiveIndex] : undefined;
    return {
      mode: this.#mode,
      phase: this.#phase,
      round: this.#round,
      elapsedSeconds: this.#elapsedSeconds,
      roundElapsedSeconds: this.#roundElapsedSeconds,
      pointsToWin: this.#pointsToWin,
      players: this.#players.map((player) => ({
        id: player.definition.id,
        displayName: player.displayName,
        teamId: player.definition.teamId ?? null,
        score: player.score,
      })),
      teams: this.#teams.map((team) => ({
        id: team.id,
        score: team.score,
        playerIds: [...team.playerIds],
      })),
      flagHolderId: this.#flagHolderId ?? null,
      flagHoldSeconds: this.#flagHoldSeconds,
      flagHoldTargetSeconds: this.#flagHoldTargetSeconds,
      fugitiveId: fugitive?.definition.id ?? null,
      fugitiveSurvivalTargetSeconds: this.#fugitiveSurvivalTargetSeconds,
      roundWinnerIds: [...this.#roundWinnerIds],
      matchWinnerIds: [...this.#matchWinnerIds],
    };
  }

  advance(stepSeconds: number, frame: MatchModeFrame): readonly MatchModeEvent[] {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new Error("Match mode stepSeconds must be a finite positive number");
    }
    if (this.#phase !== "playing") {
      return [];
    }
    const activeIds = new Set(frame.activePlayerIds);
    if (activeIds.size !== frame.activePlayerIds.length) {
      throw new Error("Match mode activePlayerIds contains duplicates");
    }
    for (const id of [
      ...activeIds,
      ...(frame.completedLapPlayerIds ?? []),
      ...(frame.flagCapturePlayerId ? [frame.flagCapturePlayerId] : []),
      ...(frame.fugitiveEliminatedByPlayerId ? [frame.fugitiveEliminatedByPlayerId] : []),
    ]) {
      if (!this.#players.some((player) => player.definition.id === id)) {
        throw new Error(`Unknown match mode player ${id}`);
      }
    }

    this.#elapsedSeconds += stepSeconds;
    this.#roundElapsedSeconds += stepSeconds;
    if (activeIds.size === 0) {
      return this.#completeDrawRound();
    }
    switch (this.#mode) {
      case "standard":
        return this.#advanceStandard(activeIds);
      case "team":
        return this.#advanceTeam(activeIds);
      case "hold-the-flag":
        return this.#advanceFlag(stepSeconds, activeIds, frame.flagCapturePlayerId);
      case "fugitive":
        return this.#advanceFugitive(activeIds, frame);
    }
  }

  startNextRound(): readonly MatchModeEvent[] {
    if (this.#phase !== "round-complete") {
      throw new Error("A new round can start only after a completed non-terminal round");
    }
    this.#phase = "playing";
    this.#round += 1;
    this.#roundElapsedSeconds = 0;
    this.#flagHolderId = undefined;
    this.#flagHoldSeconds = 0;
    this.#roundWinnerIds = [];
    if (this.#mode === "fugitive") {
      this.#fugitiveIndex = (this.#fugitiveIndex + 1) % this.#players.length;
      return [{
        type: "fugitive-assigned",
        playerId: this.#players[this.#fugitiveIndex]!.definition.id,
        round: this.#round,
      }];
    }
    return [];
  }

  #advanceStandard(activeIds: ReadonlySet<string>): readonly MatchModeEvent[] {
    if (activeIds.size > 1) {
      return [];
    }
    const winnerId = this.#players.find((player) => activeIds.has(player.definition.id))?.definition.id;
    return winnerId ? this.#completePlayerRound([winnerId], "last-player") : [];
  }

  #advanceTeam(activeIds: ReadonlySet<string>): readonly MatchModeEvent[] {
    const activeTeams = this.#teams.filter((team) => team.playerIds.some((id) => activeIds.has(id)));
    if (activeTeams.length !== 1) {
      return [];
    }
    const team = activeTeams[0]!;
    team.score += 1;
    const events: MatchModeEvent[] = [
      { type: "score-awarded", playerIds: [...team.playerIds], teamId: team.id, score: team.score },
      { type: "round-completed", round: this.#round, winnerIds: [...team.playerIds], reason: "last-team" },
    ];
    return this.#finishOrPauseRound(team.playerIds, team.score, events);
  }

  #advanceFlag(
    stepSeconds: number,
    activeIds: ReadonlySet<string>,
    capturePlayerId: string | undefined,
  ): readonly MatchModeEvent[] {
    const events: MatchModeEvent[] = [];
    if (this.#flagHolderId && !activeIds.has(this.#flagHolderId)) {
      events.push({ type: "flag-dropped", playerId: this.#flagHolderId });
      this.#flagHolderId = undefined;
      this.#flagHoldSeconds = 0;
    }
    if (capturePlayerId && activeIds.has(capturePlayerId) && capturePlayerId !== this.#flagHolderId) {
      if (this.#flagHolderId) {
        events.push({ type: "flag-dropped", playerId: this.#flagHolderId });
      }
      this.#flagHolderId = capturePlayerId;
      this.#flagHoldSeconds = 0;
      events.push({ type: "flag-captured", playerId: capturePlayerId });
    }
    if (!this.#flagHolderId) {
      return events;
    }
    this.#flagHoldSeconds += stepSeconds;
    if (this.#flagHoldSeconds + 1e-9 < this.#flagHoldTargetSeconds) {
      return events;
    }
    return [...events, ...this.#completePlayerRound([this.#flagHolderId], "flag-held")];
  }

  #advanceFugitive(
    activeIds: ReadonlySet<string>,
    frame: MatchModeFrame,
  ): readonly MatchModeEvent[] {
    const fugitiveId = this.#players[this.#fugitiveIndex]!.definition.id;
    const completedLap = frame.completedLapPlayerIds?.includes(fugitiveId) ?? false;
    if (activeIds.has(fugitiveId) && (
      completedLap || this.#roundElapsedSeconds + 1e-9 >= this.#fugitiveSurvivalTargetSeconds
    )) {
      return this.#completePlayerRound([fugitiveId], "fugitive-survived");
    }
    if (activeIds.has(fugitiveId)) {
      return [];
    }
    const interceptor = frame.fugitiveEliminatedByPlayerId
      && frame.fugitiveEliminatedByPlayerId !== fugitiveId
      ? frame.fugitiveEliminatedByPlayerId
      : this.#players.find((player) => (
          player.definition.id !== fugitiveId && activeIds.has(player.definition.id)
        ))?.definition.id;
    return interceptor ? this.#completePlayerRound([interceptor], "fugitive-intercepted") : [];
  }

  #completePlayerRound(
    winnerIds: readonly string[],
    reason: Extract<MatchModeEvent, { type: "round-completed" }>["reason"],
  ): readonly MatchModeEvent[] {
    const scores = winnerIds.map((id) => {
      const player = this.#players.find((candidate) => candidate.definition.id === id)!;
      player.score += 1;
      return player.score;
    });
    const score = Math.max(...scores);
    const events: MatchModeEvent[] = [
      { type: "score-awarded", playerIds: [...winnerIds], score },
      { type: "round-completed", round: this.#round, winnerIds: [...winnerIds], reason },
    ];
    return this.#finishOrPauseRound(winnerIds, score, events);
  }

  #completeDrawRound(): readonly MatchModeEvent[] {
    const events: MatchModeEvent[] = [];
    if (this.#flagHolderId) {
      events.push({ type: "flag-dropped", playerId: this.#flagHolderId });
      this.#flagHolderId = undefined;
      this.#flagHoldSeconds = 0;
    }
    this.#roundWinnerIds = [];
    this.#phase = "round-complete";
    events.push({
      type: "round-completed",
      round: this.#round,
      winnerIds: [],
      reason: "no-survivors",
    });
    return events;
  }

  #finishOrPauseRound(
    winnerIds: readonly string[],
    score: number,
    events: MatchModeEvent[],
  ): readonly MatchModeEvent[] {
    this.#roundWinnerIds = [...winnerIds];
    if (score >= this.#pointsToWin) {
      this.#phase = "finished";
      this.#matchWinnerIds = [...winnerIds];
      events.push({ type: "match-completed", winnerIds: [...winnerIds], score });
    } else {
      this.#phase = "round-complete";
    }
    return events;
  }
}
