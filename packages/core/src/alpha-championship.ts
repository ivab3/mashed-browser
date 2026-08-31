import type { ChampionshipDefinition } from "./championship-session.js";
import { LOCAL_PLAYER_SLOTS } from "./local-roster.js";
import type { MatchModeSessionOptions, MatchModeType } from "./match-mode-session.js";

/** Clean-room alpha cup, shared by the browser and source-independent acceptance replay. */
export function createAlphaChampionshipDefinition(
  playerCount: number,
  courseId?: number,
  courseLabel = courseId === undefined ? "Loaded Track" : `Course ${courseId}`,
): ChampionshipDefinition {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > LOCAL_PLAYER_SLOTS.length) {
    throw new Error("Alpha championship requires 2–4 players");
  }
  if (courseId !== undefined && (!Number.isInteger(courseId) || courseId < 0)) {
    throw new Error("Alpha championship courseId must be a non-negative integer");
  }
  const event = (id: string, name: string, mode: MatchModeType) => ({
    id, name: `${courseLabel} · ${name}`, mode,
    ...(courseId === undefined ? {} : { courseId }),
  });
  return {
    id: `alpha-cup-v1-${courseId ?? "route"}-${playerCount}p`,
    name: "Alpha Championship",
    entrants: LOCAL_PLAYER_SLOTS.slice(0, playerCount).map((slot) => ({
      id: slot.id, displayName: slot.label,
    })),
    events: [
      event("standard", "Standard Play", "standard"),
      event("flag", "Hold the Flag", "hold-the-flag"),
      event("fugitive", "The Fugitive", "fugitive"),
    ],
    pointsByRank: [5, 3, 2, 1],
  };
}

export function createAlphaMatchOptions(
  mode: MatchModeType,
  players: MatchModeSessionOptions["players"],
  championship: boolean,
): MatchModeSessionOptions {
  return {
    mode,
    players: players.map((player, index) => ({
      ...player,
      ...(mode === "team" ? { teamId: index % 2 === 0 ? "Orange" : "Blue" } : {}),
    })),
    pointsToWin: championship ? 1 : 8,
    flagHoldSeconds: 12,
    fugitiveSurvivalSeconds: 45,
  };
}

export interface ChampionshipRankingPlayer {
  id: string;
  completedLaps: number;
  passedCheckpoints: number;
}

/** Winners, then surviving players by progress, then last-eliminated first. */
export function rankChampionshipEvent(
  players: readonly ChampionshipRankingPlayer[],
  winnerIds: readonly string[],
  eliminationOrder: readonly string[],
): readonly string[] {
  const entrantIds = players.map((player) => player.id);
  const entrantSet = new Set(entrantIds);
  const ranking = [...new Set(winnerIds.filter((id) => entrantSet.has(id)))];
  const eliminated = new Set(eliminationOrder);
  const remaining = players.filter((player) => !ranking.includes(player.id) && !eliminated.has(player.id)).sort((left, right) => (
    right.completedLaps - left.completedLaps
    || right.passedCheckpoints - left.passedCheckpoints
    || entrantIds.indexOf(left.id) - entrantIds.indexOf(right.id)
  ));
  ranking.push(...remaining.map((player) => player.id));
  for (const id of [...eliminationOrder].reverse()) {
    if (entrantSet.has(id) && !ranking.includes(id)) {
      ranking.push(id);
    }
  }
  return ranking;
}
