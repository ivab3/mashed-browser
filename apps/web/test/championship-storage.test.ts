import type { ChampionshipSaveV1 } from "@mashed/core";
import { describe, expect, it } from "vitest";

import { ChampionshipSaveStorage } from "../src/championship-storage.js";

const save: ChampionshipSaveV1 = {
  version: 1,
  championshipId: "alpha-cup",
  phase: "event-ready",
  eventIndex: 0,
  entrants: [
    { id: "p1", points: 0, eventWins: 0, cumulativeRank: 0, lastEventRank: null },
    { id: "p2", points: 0, eventWins: 0, cumulativeRank: 0, lastEventRank: null },
  ],
  completedEvents: [],
};

describe("ChampionshipSaveStorage", () => {
  it("round-trips versioned JSON under a definition-scoped key", () => {
    const entries = new Map<string, string>();
    const storage = new ChampionshipSaveStorage(() => ({
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
    }));
    expect(storage.load(save.championshipId)).toEqual({ ok: true, save: undefined });
    expect(storage.save(save)).toEqual({ ok: true });
    expect(storage.load(save.championshipId)).toEqual({ ok: true, save });
  });

  it("contains storage and malformed-JSON failures", () => {
    const unavailable = new ChampionshipSaveStorage(() => {
      throw new Error("storage unavailable");
    });
    expect(unavailable.load(save.championshipId)).toEqual({
      ok: false,
      error: "storage unavailable",
    });
    expect(unavailable.save(save)).toEqual({
      ok: false,
      error: "storage unavailable",
    });

    const malformed = new ChampionshipSaveStorage(() => ({
      getItem: () => "{broken",
      setItem: () => undefined,
    }));
    expect(malformed.load(save.championshipId)).toMatchObject({ ok: false });
  });
});
