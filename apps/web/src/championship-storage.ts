import type { ChampionshipSaveV1 } from "@mashed/core";

interface ChampionshipKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type ChampionshipLoadResult =
  | { ok: true; save: unknown | undefined }
  | { ok: false; error: string };

export type ChampionshipSaveResult =
  | { ok: true }
  | { ok: false; error: string };

const STORAGE_PREFIX = "mashed-browser:championship:v1:";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Small failure-tolerant adapter; validation of loaded JSON remains the core session's job. */
export class ChampionshipSaveStorage {
  readonly #getStorage: () => ChampionshipKeyValueStorage;

  constructor(getStorage: () => ChampionshipKeyValueStorage) {
    this.#getStorage = getStorage;
  }

  load(championshipId: string): ChampionshipLoadResult {
    try {
      const serialized = this.#getStorage().getItem(`${STORAGE_PREFIX}${championshipId}`);
      return { ok: true, save: serialized === null ? undefined : JSON.parse(serialized) };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  save(save: ChampionshipSaveV1): ChampionshipSaveResult {
    try {
      this.#getStorage().setItem(
        `${STORAGE_PREFIX}${save.championshipId}`,
        JSON.stringify(save),
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }
}
