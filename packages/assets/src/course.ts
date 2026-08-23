export interface CourseClumpDefinition {
  index: number;
  fileName: string;
  excludedFromWorld: boolean;
  fade?: {
    checkpointStart: number;
    checkpointEnd: number;
    distance: number;
  };
}

export interface CourseObjectTemplate {
  index: number;
  displayName: string;
  dffFileName: string;
  mtsFileName: string;
}

export interface CourseDefinition {
  id: number;
  textureDictionaryFileName?: string;
  worldBspFileName?: string;
  aiBspFileName?: string;
  collisionBspFileName?: string;
  lightsFileName?: string;
  skies: ReadonlyArray<{ index: number; fileName: string }>;
  clumps: readonly CourseClumpDefinition[];
  objectTemplates: readonly CourseObjectTemplate[];
}

type CourseArgument = number | string;

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

function argumentTokens(source: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"' && source[index - 1] !== "\\") {
      quoted = !quoted;
      current += character;
    } else if (character === "," && !quoted) {
      tokens.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (quoted) {
    throw new Error("COURSE.LUA contains an unterminated string");
  }
  if (current.trim() || source.trim()) {
    tokens.push(current.trim());
  }
  return tokens;
}

function resolveArgument(token: string, constants: ReadonlyMap<string, number>): CourseArgument {
  if (/^"(?:[^"\\]|\\.)*"$/.test(token)) {
    return JSON.parse(token) as string;
  }
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
    return Number(token);
  }
  const constant = constants.get(token);
  if (constant !== undefined) {
    return constant;
  }
  throw new Error(`COURSE.LUA references unsupported value ${token}`);
}

function numberAt(args: readonly CourseArgument[], index: number, call: string): number {
  const value = args[index];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${call} argument ${index + 1} must be a number`);
  }
  return value;
}

function integerAt(args: readonly CourseArgument[], index: number, call: string): number {
  const value = numberAt(args, index, call);
  if (!Number.isInteger(value)) {
    throw new Error(`${call} argument ${index + 1} must be an integer`);
  }
  return value;
}

function stringAt(args: readonly CourseArgument[], index: number, call: string): string {
  const value = args[index];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${call} argument ${index + 1} must be a filename string`);
  }
  return value;
}

/** Parses the declarative asset registry in COURSE.LUA without executing Lua. */
export function parseCourseLua(source: string): CourseDefinition {
  const lines = source.split(/\r?\n/).map((line) => withoutComment(line).trim());
  const constants = new Map<string, number>();
  for (const line of lines) {
    const declaration = line.match(/^local\s+([A-Za-z_]\w*)\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/);
    if (declaration?.[1] && declaration[2]) {
      constants.set(declaration[1], Number(declaration[2]));
    }
  }

  let id: number | undefined;
  let textureDictionaryFileName: string | undefined;
  let worldBspFileName: string | undefined;
  let aiBspFileName: string | undefined;
  let collisionBspFileName: string | undefined;
  let lightsFileName: string | undefined;
  const skies: Array<{ index: number; fileName: string }> = [];
  const clumpFiles = new Map<number, string>();
  const excludedClumps = new Set<number>();
  const fades = new Map<number, NonNullable<CourseClumpDefinition["fade"]>>();
  const objectTemplates: CourseObjectTemplate[] = [];

  for (const line of lines) {
    const call = line.match(/^([A-Za-z_]\w*)\s*\((.*)\)\s*$/);
    if (!call?.[1]) {
      continue;
    }
    const name = call[1];
    const relevant = new Set([
      "Course_Id",
      "Texture_Dictionary_Filename",
      "World_Bsp_Filename",
      "AI_Bsp_Filename",
      "Collision_Bsp_Filename",
      "Lights_Filename",
      "Sky_Filename",
      "Clump_Filename",
      "Clump_Exclude_From_World",
      "ClumpFade",
      "RWP_Object",
    ]);
    if (!relevant.has(name)) {
      continue;
    }
    const args = argumentTokens(call[2] ?? "").map((token) => resolveArgument(token, constants));
    switch (name) {
      case "Course_Id":
        id = integerAt(args, 0, name);
        break;
      case "Texture_Dictionary_Filename":
        textureDictionaryFileName = stringAt(args, 0, name);
        break;
      case "World_Bsp_Filename":
        worldBspFileName = stringAt(args, 0, name);
        break;
      case "AI_Bsp_Filename":
        aiBspFileName = stringAt(args, 0, name);
        break;
      case "Collision_Bsp_Filename":
        collisionBspFileName = stringAt(args, 0, name);
        break;
      case "Lights_Filename":
        lightsFileName = stringAt(args, 0, name);
        break;
      case "Sky_Filename":
        skies.push({ index: integerAt(args, 0, name), fileName: stringAt(args, 1, name) });
        break;
      case "Clump_Filename": {
        const index = integerAt(args, 0, name);
        if (clumpFiles.has(index)) {
          throw new Error(`COURSE.LUA declares clump ${index} more than once`);
        }
        clumpFiles.set(index, stringAt(args, 1, name));
        break;
      }
      case "Clump_Exclude_From_World":
        excludedClumps.add(integerAt(args, 0, name));
        break;
      case "ClumpFade":
        fades.set(integerAt(args, 0, name), {
          checkpointStart: integerAt(args, 1, name),
          checkpointEnd: integerAt(args, 2, name),
          distance: numberAt(args, 3, name),
        });
        break;
      case "RWP_Object":
        objectTemplates.push({
          index: integerAt(args, 0, name),
          displayName: stringAt(args, 1, name),
          dffFileName: stringAt(args, 2, name),
          mtsFileName: stringAt(args, 3, name),
        });
        break;
    }
  }
  if (id === undefined) {
    throw new Error("COURSE.LUA is missing Course_Id");
  }
  const clumps = [...clumpFiles.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, fileName]) => ({
      index,
      fileName,
      excludedFromWorld: excludedClumps.has(index),
      ...(fades.has(index) ? { fade: fades.get(index)! } : {}),
    }));
  return {
    id,
    ...(textureDictionaryFileName === undefined ? {} : { textureDictionaryFileName }),
    ...(worldBspFileName === undefined ? {} : { worldBspFileName }),
    ...(aiBspFileName === undefined ? {} : { aiBspFileName }),
    ...(collisionBspFileName === undefined ? {} : { collisionBspFileName }),
    ...(lightsFileName === undefined ? {} : { lightsFileName }),
    skies: skies.sort((left, right) => left.index - right.index),
    clumps,
    objectTemplates: objectTemplates.sort((left, right) => left.index - right.index),
  };
}
