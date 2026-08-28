import {
  CameraEliminationTracker,
  CombatSession,
  FixedStepClock,
  RaceSession,
  type CameraEliminationConfig,
  type CameraEliminationUpdate,
  type CombatEvent,
  type CombatPlayerFrames,
  type CombatSessionOptions,
  type CombatSnapshot,
  type CombatWorldHit,
  type RaceEvent,
  type RaceSessionOptions,
  type RaceSnapshot,
  type TrackVector3,
} from "@mashed/core";

import type { ReplayTape } from "./index.js";

export interface MatchReplayFrame {
  positions: Readonly<Record<string, TrackVector3 | undefined>>;
  headingsRadians?: Readonly<Record<string, number | undefined>>;
  useRequests?: Readonly<Record<string, boolean | undefined>>;
  distanceToNextCheckpointMeters?: Readonly<Record<string, number | undefined>>;
  worldHits?: Readonly<Record<number, CombatWorldHit | undefined>>;
}

export interface MatchReplayDefinition {
  race: RaceSessionOptions;
  combat: CombatSessionOptions;
  camera: CameraEliminationConfig;
}

export type MatchReplayEvent =
  | { step: number; source: "race"; event: RaceEvent }
  | { step: number; source: "combat"; event: CombatEvent }
  | { step: number; source: "camera"; event: CameraEliminationUpdate };

export interface MatchReplayOutcome {
  processedSteps: number;
  race: RaceSnapshot;
  combat: CombatSnapshot;
  events: readonly MatchReplayEvent[];
}

export interface MatchReplayRun {
  refreshRate: number;
  presentationFrames: number;
  outcome: MatchReplayOutcome;
}

function appendRaceEvents(
  target: MatchReplayEvent[],
  step: number,
  events: readonly RaceEvent[],
): void {
  for (const event of events) {
    target.push({ step, source: "race", event });
  }
}

/**
 * Replays the complete pure match stack behind an arbitrary presentation clock. Physics collision
 * answers are recorded alongside player input, so the outcome remains independent of Rapier and DOM
 * timing while still covering race, camera knockout, combat, and last-player-standing integration.
 */
export function runMatchReplay(
  definition: MatchReplayDefinition,
  tape: ReplayTape<MatchReplayFrame>,
  refreshRate: number,
): MatchReplayRun {
  if (!Number.isFinite(refreshRate) || refreshRate <= 0) {
    throw new Error("Match replay refreshRate must be a finite positive number");
  }

  const clock = new FixedStepClock({ stepSeconds: tape.stepSeconds });
  const race = new RaceSession(definition.race);
  const combat = new CombatSession(definition.combat);
  const camera = new CameraEliminationTracker(definition.camera);
  const events: MatchReplayEvent[] = [];
  let processedSteps = 0;
  let presentationFrames = 0;

  const simulate = (stepSeconds: number, step: number): void => {
    // A 30 Hz presentation frame can contain two simulation callbacks. Once the first callback
    // finishes the match, the remaining callback must not mutate any session.
    if (race.phase === "finished") {
      return;
    }
    const frame = tape.frames[processedSteps];
    if (!frame) {
      throw new Error(`Match replay exhausted after ${processedSteps} steps before the race finished`);
    }
    processedSteps += 1;

    appendRaceEvents(events, step, race.advance(stepSeconds, frame.positions));
    const activePlayers = race.snapshot.players.filter((player) => player.status === "racing");
    const cameraUpdate = camera.update(stepSeconds, activePlayers.flatMap((player) => {
      const position = frame.positions[player.id];
      if (!position) {
        return [];
      }
      return [{
        id: player.id,
        position,
        completedLaps: player.progress.completedLaps,
        passedCheckpoints: player.progress.passedCheckpoints,
        distanceToNextCheckpointMeters:
          frame.distanceToNextCheckpointMeters?.[player.id] ?? 0,
      }];
    }));
    if (cameraUpdate.warnings.length > 0 || cameraUpdate.eliminatedPlayerIds.length > 0) {
      events.push({ step, source: "camera", event: cameraUpdate });
    }
    for (const playerId of cameraUpdate.eliminatedPlayerIds) {
      appendRaceEvents(events, step, race.eliminatePlayer(playerId, "camera-distance"));
    }

    const racingIds = new Set(
      race.snapshot.players
        .filter((player) => player.status === "racing")
        .map((player) => player.id),
    );
    const combatFrames: Record<string, CombatPlayerFrames[string]> = {};
    for (const [playerId, position] of Object.entries(frame.positions)) {
      if (position && racingIds.has(playerId)) {
        combatFrames[playerId] = {
          position,
          headingRadians: frame.headingsRadians?.[playerId] ?? 0,
        };
      }
    }
    const combatEvents = combat.advance(
      stepSeconds,
      combatFrames,
      frame.useRequests,
      (segment) => frame.worldHits?.[segment.projectileId],
    );
    for (const event of combatEvents) {
      events.push({ step, source: "combat", event });
      if (event.type === "player-destroyed") {
        appendRaceEvents(events, step, race.eliminatePlayer(event.playerId, "destroyed"));
      }
    }
  };

  clock.advance(0, simulate);
  const maximumPresentationFrames = Math.ceil(
    tape.frames.length * tape.stepSeconds * refreshRate,
  ) + 1;
  while (race.phase !== "finished" && presentationFrames < maximumPresentationFrames) {
    presentationFrames += 1;
    clock.advance(presentationFrames / refreshRate, simulate);
  }
  if (race.phase !== "finished") {
    throw new Error(`Match replay did not finish within ${tape.frames.length} recorded steps`);
  }

  return {
    refreshRate,
    presentationFrames,
    outcome: {
      processedSteps,
      race: race.snapshot,
      combat: combat.snapshot,
      events,
    },
  };
}
