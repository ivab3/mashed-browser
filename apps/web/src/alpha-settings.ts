export type AlphaDifficulty = "easy" | "normal" | "hard";
export type AlphaGraphicsQuality = "performance" | "balanced" | "quality";

export interface AlphaSettingsV1 {
  readonly version: 1;
  readonly difficulty: AlphaDifficulty;
  readonly gamepadDeadzone: number;
  readonly masterVolume: number;
  readonly muted: boolean;
  readonly graphicsQuality: AlphaGraphicsQuality;
}

interface SettingsKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type AlphaSettingsLoadResult =
  | { ok: true; settings: AlphaSettingsV1; restored: boolean }
  | { ok: false; error: string; settings: AlphaSettingsV1; restored: false };

export type AlphaSettingsSaveResult =
  | { ok: true }
  | { ok: false; error: string };

const STORAGE_KEY = "mashed-browser:settings:v1";

export const DEFAULT_ALPHA_SETTINGS: AlphaSettingsV1 = Object.freeze({
  version: 1,
  difficulty: "normal",
  gamepadDeadzone: 0.12,
  masterVolume: 0.7,
  muted: false,
  graphicsQuality: "quality",
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finiteRange(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

/** Strictly validates persisted settings rather than trusting parsed JSON as typed input. */
export function parseAlphaSettings(value: unknown): AlphaSettingsV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Settings must be an object");
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = new Set([
    "version",
    "difficulty",
    "gamepadDeadzone",
    "masterVolume",
    "muted",
    "graphicsQuality",
  ]);
  const unexpectedKey = Object.keys(record).find((key) => !expectedKeys.has(key));
  if (unexpectedKey) {
    throw new Error(`Settings field ${unexpectedKey} is not supported`);
  }
  if (record["version"] !== 1) {
    throw new Error("Unsupported settings version");
  }
  const difficulty = record["difficulty"];
  if (difficulty !== "easy" && difficulty !== "normal" && difficulty !== "hard") {
    throw new Error("Settings difficulty is invalid");
  }
  const graphicsQuality = record["graphicsQuality"];
  if (
    graphicsQuality !== "performance"
    && graphicsQuality !== "balanced"
    && graphicsQuality !== "quality"
  ) {
    throw new Error("Settings graphics quality is invalid");
  }
  if (typeof record["muted"] !== "boolean") {
    throw new Error("Settings muted flag is invalid");
  }
  return Object.freeze({
    version: 1,
    difficulty,
    gamepadDeadzone: finiteRange(record["gamepadDeadzone"], "gamepadDeadzone", 0, 0.5),
    masterVolume: finiteRange(record["masterVolume"], "masterVolume", 0, 1),
    muted: record["muted"],
    graphicsQuality,
  });
}

/** Failure-tolerant local adapter with a stable versioned key and strict restore validation. */
export class AlphaSettingsStorage {
  readonly #getStorage: () => SettingsKeyValueStorage;

  constructor(getStorage: () => SettingsKeyValueStorage) {
    this.#getStorage = getStorage;
  }

  load(): AlphaSettingsLoadResult {
    try {
      const serialized = this.#getStorage().getItem(STORAGE_KEY);
      return serialized === null
        ? { ok: true, settings: DEFAULT_ALPHA_SETTINGS, restored: false }
        : { ok: true, settings: parseAlphaSettings(JSON.parse(serialized)), restored: true };
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(error),
        settings: DEFAULT_ALPHA_SETTINGS,
        restored: false,
      };
    }
  }

  save(settings: AlphaSettingsV1): AlphaSettingsSaveResult {
    try {
      const validated = parseAlphaSettings(settings);
      this.#getStorage().setItem(STORAGE_KEY, JSON.stringify(validated));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }
}
