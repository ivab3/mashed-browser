import type { TrackVector3 } from "@mashed/core";

import { ReplayRecorder, type ReplayTape } from "./index.js";
import type { MatchReplayDefinition, MatchReplayFrame } from "./match-replay.js";

const STEP_SECONDS = 1 / 60;
const PLAYER_IDS = ["vehicle-one", "vehicle-two", "vehicle-three", "vehicle-four"] as const;

export interface StageFiveReplayScenario {
  definition: MatchReplayDefinition;
  tape: ReplayTape<MatchReplayFrame>;
}

/** A compact deterministic M1 scenario that exercises pickup, world impact, destruction, and camera KOs. */
export function createStageFiveReplayScenario(): StageFiveReplayScenario {
  const recorder = new ReplayRecorder<MatchReplayFrame>(0x5_1_2026, STEP_SECONDS);
  for (let step = 0; step < 180; step += 1) {
    const positions: Record<string, TrackVector3> = {
      "vehicle-one": [0, 0, 0],
      "vehicle-two": [step >= 90 ? 30 : 6, 0, 0],
      "vehicle-three": [30, 0, 0],
      "vehicle-four": [0, 0, 5.3],
    };
    recorder.record({
      positions,
      headingsRadians: {
        "vehicle-one": 0,
        "vehicle-two": Math.PI,
        "vehicle-three": 0,
        "vehicle-four": 0,
      },
      useRequests: {
        ...(step === 1 ? { "vehicle-one": true } : {}),
        ...(step >= 2 && step <= 82 && (step - 2) % 8 === 0
          ? { "vehicle-two": true }
          : {}),
      },
      distanceToNextCheckpointMeters: Object.fromEntries(PLAYER_IDS.map((id) => [id, 10])),
      worldHits: step === 1
        ? { 1: { fraction: 0.5, normal: [0, 0, -1], objectId: "arena-wall" } }
        : {},
    });
  }

  return {
    definition: {
      race: {
        players: PLAYER_IDS.map((id, index) => ({ id, displayName: `P${index + 1}` })),
        course: {
          checkpoints: [
            {
              id: 0,
              center: [0, 0, 100],
              triangles: [[[-20, -5, 100], [20, -5, 100], [0, 5, 100]]],
            },
            {
              id: 1,
              center: [0, 0, 200],
              triangles: [[[-20, -5, 200], [20, -5, 200], [0, 5, 200]]],
            },
          ],
        },
        totalLaps: 1,
        countdownSeconds: 0,
        finishWhenOnePlayerRemains: true,
      },
      combat: {
        players: PLAYER_IDS.map((id, index) => ({ id, displayName: `P${index + 1}` })),
        pickups: [
          { id: "rocket-pickup", weapon: "rocket", position: [0, 0, 0] },
          { id: "machine-gun-pickup", weapon: "machine-gun", position: [6, 0, 0] },
        ],
        maximumHealth: 30,
      },
      camera: {
        maximumDistanceFromLeaderMeters: 20,
        maximumDistanceFromCenterMeters: 12,
        graceSeconds: 0.25,
      },
    },
    tape: recorder.finish(),
  };
}
