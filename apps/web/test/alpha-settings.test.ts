import { describe, expect, it } from "vitest";

import {
  AlphaSettingsStorage,
  DEFAULT_ALPHA_SETTINGS,
  parseAlphaSettings,
  type AlphaSettingsV1,
} from "../src/alpha-settings.js";

const customSettings: AlphaSettingsV1 = {
  version: 1,
  difficulty: "hard",
  gamepadDeadzone: 0.24,
  masterVolume: 0.35,
  muted: true,
  graphicsQuality: "performance",
};

describe("alpha settings", () => {
  it("round-trips a strictly validated versioned record", () => {
    const entries = new Map<string, string>();
    const storage = new AlphaSettingsStorage(() => ({
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
    }));

    expect(storage.load()).toEqual({
      ok: true,
      settings: DEFAULT_ALPHA_SETTINGS,
      restored: false,
    });
    expect(storage.save(customSettings)).toEqual({ ok: true });
    expect(storage.load()).toEqual({ ok: true, settings: customSettings, restored: true });
  });

  it("rejects unknown versions, invalid enums, and out-of-range values", () => {
    expect(() => parseAlphaSettings({ ...customSettings, version: 2 })).toThrow("version");
    expect(() => parseAlphaSettings({ ...customSettings, difficulty: "expert" })).toThrow("difficulty");
    expect(() => parseAlphaSettings({ ...customSettings, gamepadDeadzone: 0.8 })).toThrow("gamepadDeadzone");
    expect(() => parseAlphaSettings({ ...customSettings, masterVolume: Number.NaN })).toThrow("masterVolume");
    expect(() => parseAlphaSettings({ ...customSettings, futureOption: true })).toThrow("futureOption");
  });

  it("contains storage and malformed-data failures while returning safe defaults", () => {
    const unavailable = new AlphaSettingsStorage(() => {
      throw new Error("storage unavailable");
    });
    expect(unavailable.load()).toEqual({
      ok: false,
      error: "storage unavailable",
      settings: DEFAULT_ALPHA_SETTINGS,
      restored: false,
    });
    expect(unavailable.save(customSettings)).toEqual({
      ok: false,
      error: "storage unavailable",
    });

    const malformed = new AlphaSettingsStorage(() => ({
      getItem: () => JSON.stringify({ ...customSettings, graphicsQuality: "ultra" }),
      setItem: () => undefined,
    }));
    expect(malformed.load()).toMatchObject({
      ok: false,
      settings: DEFAULT_ALPHA_SETTINGS,
      restored: false,
    });
  });
});
