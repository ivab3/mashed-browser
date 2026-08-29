export const ORIGINAL_POWERUP_IDS = Object.freeze({
  mine: 6,
  mortar: 7,
  detonator: 8,
  "machine-gun": 9,
  drum: 10,
  "guided-missile": 11,
  "proximity-mine": 12,
  "rear-flame": 16,
  shotgun: 17,
  flash: 18,
  oil: 19,
  blank: 21,
} as const);

export type OriginalPowerupType = keyof typeof ORIGINAL_POWERUP_IDS;

export interface OriginalPowerupPlacement {
  id: string;
  type: OriginalPowerupType;
  typeId: number;
  position: readonly [number, number, number];
  respawnSeconds: number;
}

export interface TrackPowerupLoadout {
  courseId: number;
  tier: number;
  powerups: readonly OriginalPowerupType[];
}

const POWERUP_TYPE_BY_ID = new Map<number, OriginalPowerupType>(
  Object.entries(ORIGINAL_POWERUP_IDS).map(([type, id]) => [id, type as OriginalPowerupType]),
);

function withoutComment(line: string): string {
  let quoted = false;
  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] === '"' && line[index - 1] !== "\\") {
      quoted = !quoted;
    }
    if (!quoted && line[index] === "-" && line[index + 1] === "-") {
      return line.slice(0, index);
    }
  }
  return line;
}

function sourceLines(source: string): string[] {
  return source.split(/\r?\n/).map((line) => withoutComment(line).trim());
}

function numericConstants(lines: readonly string[]): ReadonlyMap<string, number> {
  const constants = new Map<string, number>();
  for (const line of lines) {
    const declaration = line.match(
      /^local\s+([A-Za-z_]\w*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/,
    );
    if (declaration?.[1] && declaration[2]) {
      constants.set(declaration[1], Number(declaration[2]));
    }
  }
  return constants;
}

function argumentTokens(source: string): string[] {
  return source.split(",").map((token) => token.trim()).filter(Boolean);
}

function numericArgument(token: string, constants: ReadonlyMap<string, number>, call: string): number {
  const value = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)
    ? Number(token)
    : constants.get(token);
  if (value === undefined || !Number.isFinite(value)) {
    throw new Error(`${call} references unsupported numeric value ${token}`);
  }
  return value;
}

function callArguments(
  line: string,
  expectedName: string,
  constants: ReadonlyMap<string, number>,
): readonly number[] | undefined {
  const call = line.match(/^([A-Za-z_]\w*)\s*\((.*)\)\s*$/);
  if (call?.[1] !== expectedName) {
    return undefined;
  }
  return argumentTokens(call[2] ?? "").map((token) => numericArgument(token, constants, expectedName));
}

function powerupType(typeId: number, call: string): OriginalPowerupType {
  if (!Number.isInteger(typeId)) {
    throw new Error(`${call} power-up type must be an integer`);
  }
  const type = POWERUP_TYPE_BY_ID.get(typeId);
  if (!type) {
    throw new Error(`${call} references unsupported power-up type ${typeId}`);
  }
  return type;
}

/** Parses source-authored pickup positions without executing POWERUPS_GOLD.LUA. */
export function parsePowerupPlacementsLua(source: string): readonly OriginalPowerupPlacement[] {
  const lines = sourceLines(source);
  const constants = numericConstants(lines);
  const placements: OriginalPowerupPlacement[] = [];
  let position: readonly [number, number, number] | undefined;
  let typeId: number | undefined;
  let respawnSeconds: number | undefined;

  for (const line of lines) {
    const positionArgs = callArguments(line, "Set_Current_Position", constants);
    if (positionArgs) {
      if (positionArgs.length !== 3) {
        throw new Error("Set_Current_Position requires exactly three coordinates");
      }
      position = [positionArgs[0]!, positionArgs[1]!, positionArgs[2]!];
      continue;
    }
    const typeArgs = callArguments(line, "Set_Current_Type", constants);
    if (typeArgs) {
      if (typeArgs.length !== 1) {
        throw new Error("Set_Current_Type requires exactly one power-up type");
      }
      typeId = typeArgs[0]!;
      powerupType(typeId, "Set_Current_Type");
      continue;
    }
    const respawnArgs = callArguments(line, "Set_Current_Respawn_Time", constants);
    if (respawnArgs) {
      if (respawnArgs.length !== 1 || respawnArgs[0]! < 0) {
        throw new Error("Set_Current_Respawn_Time requires one non-negative duration");
      }
      respawnSeconds = respawnArgs[0]!;
      continue;
    }
    const placeArgs = callArguments(line, "Place_Powerup", constants);
    if (!placeArgs) {
      continue;
    }
    if (placeArgs.length !== 0) {
      throw new Error("Place_Powerup does not accept arguments");
    }
    if (!position || typeId === undefined || respawnSeconds === undefined) {
      throw new Error("Place_Powerup requires position, type, and respawn time to be set first");
    }
    placements.push({
      id: `source-powerup-${placements.length + 1}`,
      type: powerupType(typeId, "Place_Powerup"),
      typeId,
      position: [...position],
      respawnSeconds,
    });
  }
  if (placements.length === 0) {
    throw new Error("POWERUPS_GOLD.LUA contains no power-up placements");
  }
  return placements;
}

/** Parses the course-to-power-up registry in POWERUPS_ALL.LUA without executing Lua. */
export function parseTrackPowerupLoadoutsLua(source: string): readonly TrackPowerupLoadout[] {
  const lines = sourceLines(source);
  const constants = numericConstants(lines);
  const loadouts: TrackPowerupLoadout[] = [];
  const courseIds = new Set<number>();
  for (const line of lines) {
    const args = callArguments(line, "Set_Track_Powerups", constants);
    if (!args) {
      continue;
    }
    if (args.length < 3) {
      throw new Error("Set_Track_Powerups requires a course, tier, and at least one power-up slot");
    }
    const [courseId, tier, ...typeIds] = args;
    if (!Number.isInteger(courseId) || !Number.isInteger(tier) || tier! < 0) {
      throw new Error("Set_Track_Powerups course and tier must be non-negative integers");
    }
    if (courseIds.has(courseId!)) {
      throw new Error(`Set_Track_Powerups declares course ${courseId} more than once`);
    }
    courseIds.add(courseId!);
    const powerups = typeIds
      .filter((typeId) => typeId !== -1)
      .map((typeId) => powerupType(typeId, "Set_Track_Powerups"));
    loadouts.push({ courseId: courseId!, tier: tier!, powerups });
  }
  if (loadouts.length === 0) {
    throw new Error("POWERUPS_ALL.LUA contains no track loadouts");
  }
  return loadouts.sort((left, right) => left.courseId - right.courseId);
}
