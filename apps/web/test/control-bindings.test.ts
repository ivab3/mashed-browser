import { describe, expect, it } from "vitest";
import { BrowserVehicleInput } from "@mashed/input";

import {
  ControlBindingsStorage,
  DEFAULT_CONTROL_BINDINGS,
  parseControlBindings,
  rebindControlAction,
  vehicleKeyboardBindings,
} from "../src/control-bindings.js";

describe("P1 control bindings", () => {
  it("swaps occupied keys and emits input-adapter bindings", () => {
    const rebound = rebindControlAction(DEFAULT_CONTROL_BINDINGS, "forward", "KeyS");
    expect(rebound.playerOne).toMatchObject({ forward: "KeyS", reverse: "KeyW" });
    expect(vehicleKeyboardBindings(rebound)).toMatchObject({
      forward: ["KeyS"],
      reverse: ["KeyW"],
      handbrake: ["Space"],
    });
  });

  it("rejects reserved multiplayer/global keys, duplicates, and unknown fields", () => {
    expect(() => rebindControlAction(DEFAULT_CONTROL_BINDINGS, "forward", "ArrowUp")).toThrow("reserved");
    expect(() => rebindControlAction(DEFAULT_CONTROL_BINDINGS, "forward", "KeyC")).toThrow("reserved");
    for (const code of ["Tab", "MetaLeft", "F5", "Unidentified", "NotARealKey"]) {
      expect(() => rebindControlAction(DEFAULT_CONTROL_BINDINGS, "forward", code)).toThrow("unsupported");
    }
    expect(() => parseControlBindings({
      ...DEFAULT_CONTROL_BINDINGS,
      playerOne: { ...DEFAULT_CONTROL_BINDINGS.playerOne, reverse: "KeyW" },
    })).toThrow("unique");
    expect(() => parseControlBindings({ ...DEFAULT_CONTROL_BINDINGS, future: true })).toThrow("unsupported");
  });

  it("drives the production input adapter with the new key and releases the old one", () => {
    const target = new EventTarget();
    const input = new BrowserVehicleInput(target as Window, {
      keyboard: vehicleKeyboardBindings(rebindControlAction(DEFAULT_CONTROL_BINDINGS, "forward", "KeyI")),
    });
    const dispatch = (type: string, code: string) => {
      const event = new Event(type, { cancelable: true });
      Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
      target.dispatchEvent(event);
    };
    try {
      dispatch("keydown", "KeyW");
      expect(input.sample([]).drive).toBe(0);
      dispatch("keydown", "KeyI");
      expect(input.sample([]).drive).toBe(1);
      dispatch("keyup", "KeyI");
      expect(input.sample([]).drive).toBe(0);
      dispatch("keydown", "KeyS");
      expect(input.sample([]).drive).toBe(-1);
    } finally {
      input.dispose();
    }
  });

  it("round-trips valid data and contains malformed or unavailable storage", () => {
    const entries = new Map<string, string>();
    const storage = new ControlBindingsStorage(() => ({
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
    }));
    const custom = rebindControlAction(DEFAULT_CONTROL_BINDINGS, "forward", "KeyI");
    expect(storage.load()).toEqual({
      ok: true,
      bindings: DEFAULT_CONTROL_BINDINGS,
      restored: false,
    });
    expect(storage.save(custom)).toEqual({ ok: true });
    expect(storage.load()).toEqual({ ok: true, bindings: custom, restored: true });

    const unavailable = new ControlBindingsStorage(() => {
      throw new Error("storage unavailable");
    });
    expect(unavailable.load()).toMatchObject({
      ok: false,
      error: "storage unavailable",
      bindings: DEFAULT_CONTROL_BINDINGS,
    });
    expect(unavailable.save(custom)).toEqual({ ok: false, error: "storage unavailable" });

    const malformed = new ControlBindingsStorage(() => ({
      getItem: () => "{broken",
      setItem: () => undefined,
    }));
    expect(malformed.load()).toMatchObject({ ok: false, bindings: DEFAULT_CONTROL_BINDINGS });
  });
});
