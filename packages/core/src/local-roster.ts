export const LOCAL_PLAYER_SLOTS = Object.freeze([
  { id: "vehicle-one", label: "P1", gamepadIndex: 0 },
  { id: "vehicle-two", label: "P2", gamepadIndex: 1 },
  { id: "vehicle-three", label: "P3", gamepadIndex: 2 },
  { id: "vehicle-four", label: "P4", gamepadIndex: 3 },
] as const);

export type LocalPlayerId = (typeof LOCAL_PLAYER_SLOTS)[number]["id"];

export interface RaceStartPose {
  position: readonly [number, number, number];
  headingRadians: number;
}

export interface StartingGridConfig {
  columns: number;
  lateralSpacingMeters: number;
  longitudinalSpacingMeters: number;
}

export interface LocalPlayerGridSlot {
  id: LocalPlayerId;
  label: string;
  gamepadIndex: number;
  spawn: RaceStartPose;
}

export const DEFAULT_STARTING_GRID: Readonly<StartingGridConfig> = Object.freeze({
  columns: 2,
  lateralSpacingMeters: 1.8,
  longitudinalSpacingMeters: 2.8,
});

function validateStartPose(anchor: RaceStartPose): void {
  if (
    anchor.position.some((component) => !Number.isFinite(component))
    || !Number.isFinite(anchor.headingRadians)
  ) {
    throw new Error("Starting-grid anchor must contain finite coordinates and heading");
  }
}

/** Builds the compact two-by-two grid used by local Mashed matches around a track spawn anchor. */
export function createLocalPlayerGrid(
  anchor: RaceStartPose,
  playerCount: number,
  config: StartingGridConfig = DEFAULT_STARTING_GRID,
): readonly LocalPlayerGridSlot[] {
  validateStartPose(anchor);
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > LOCAL_PLAYER_SLOTS.length) {
    throw new Error(`Local player count must be between 1 and ${LOCAL_PLAYER_SLOTS.length}`);
  }
  if (!Number.isInteger(config.columns) || config.columns < 1 || config.columns > LOCAL_PLAYER_SLOTS.length) {
    throw new Error("Starting-grid columns must be a positive integer within the local-player limit");
  }
  if (
    !Number.isFinite(config.lateralSpacingMeters)
    || config.lateralSpacingMeters <= 0
    || !Number.isFinite(config.longitudinalSpacingMeters)
    || config.longitudinalSpacingMeters <= 0
  ) {
    throw new Error("Starting-grid spacing must be finite and positive");
  }

  const forwardX = Math.sin(anchor.headingRadians);
  const forwardZ = Math.cos(anchor.headingRadians);
  const rightX = Math.cos(anchor.headingRadians);
  const rightZ = -Math.sin(anchor.headingRadians);
  return LOCAL_PLAYER_SLOTS.slice(0, playerCount).map((slot, index) => {
    const row = Math.floor(index / config.columns);
    const column = index % config.columns;
    const rowPlayerCount = Math.min(config.columns, playerCount - row * config.columns);
    const lateralOffset = (column - (rowPlayerCount - 1) / 2) * config.lateralSpacingMeters;
    const longitudinalOffset = -row * config.longitudinalSpacingMeters;
    return {
      ...slot,
      spawn: {
        position: [
          anchor.position[0] + rightX * lateralOffset + forwardX * longitudinalOffset,
          anchor.position[1],
          anchor.position[2] + rightZ * lateralOffset + forwardZ * longitudinalOffset,
        ],
        headingRadians: anchor.headingRadians,
      },
    };
  });
}
