import {
  ChampionshipSession,
  createAlphaChampionshipDefinition,
  createAlphaMatchOptions,
  rankChampionshipEvent,
  type ChampionshipEvent,
  type ChampionshipSaveV1,
  type MatchModeFrame,
} from "@mashed/core";

import { runMatchModeReplay, type MatchModeReplayOutcome } from "./match-mode-replay.js";

/** Source-independent recorded rule frames, not a substitute for the browser/physics acceptance. */
export function runAlphaSeriesReplay(playerCount: number, courseId: number, refreshRate: number) {
  const definition = createAlphaChampionshipDefinition(playerCount, courseId);
  const playerIds = definition.entrants.map((player) => player.id);
  let session = new ChampionshipSession(definition);
  const rounds: MatchModeReplayOutcome[] = [];
  const events: ChampionshipEvent[] = [];
  const saves: ChampionshipSaveV1[] = [];
  const restore = () => {
    const save = session.save();
    session = ChampionshipSession.restore(definition, JSON.parse(JSON.stringify(save)) as ChampionshipSaveV1);
    if (JSON.stringify(session.save()) !== JSON.stringify(save)) {
      throw new Error("Alpha series save changed during JSON restore");
    }
    saves.push(save);
  };
  restore();
  for (const event of definition.events) {
    const frames: MatchModeFrame[] = [];
    // Standard eliminates to P2; flag changes hands and is held for the real 12-second target;
    // fugitive survives for the real 45-second target. No manual round-completion shortcut.
    for (let step = 0; step < 2800; step += 1) {
      frames.push({
        activePlayerIds: event.mode === "standard" && step >= 90 ? [playerIds[1]!] : playerIds,
        ...(event.mode === "hold-the-flag"
          ? { flagCapturePlayerId: step < 30 ? playerIds[1]! : playerIds[0]! }
          : {}),
      });
    }
    const run = runMatchModeReplay(
      createAlphaMatchOptions(event.mode, definition.entrants, true),
      { version: 1, seed: 0x6_7_c, stepSeconds: 1 / 60, frames },
      refreshRate,
    );
    if (run.outcome.snapshot.phase !== "finished") {
      throw new Error(`Alpha event ${event.id} did not finish its match`);
    }
    rounds.push(run.outcome);
    const winners = run.outcome.snapshot.matchWinnerIds;
    const eliminated = event.mode === "standard" ? playerIds.filter((id) => !winners.includes(id)) : [];
    events.push(...session.completeEvent(rankChampionshipEvent(
      playerIds.map((id, index) => ({ id, completedLaps: 0, passedCheckpoints: playerCount - index })),
      winners, eliminated,
    )));
    restore();
    if (session.snapshot.phase === "event-complete") {
      events.push(...session.startNextEvent());
      restore();
    }
  }
  const finished = session.snapshot;
  const restarted = new ChampionshipSession(definition).snapshot;
  return { rounds, events, saves, finished, restarted };
}
