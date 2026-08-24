import { describe, expect, it } from "vitest";

import { applyDeadzone, BrowserVehicleInput, sanitizeVehicleInput } from "../src/index.js";

function keyboardEvent(type: "keydown" | "keyup", code: string): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: false },
  });
  return event;
}

describe("vehicle input normalization", () => {
  it("rescales analog input outside the deadzone", () => {
    expect(applyDeadzone(0.1, 0.12)).toBe(0);
    expect(applyDeadzone(-0.56, 0.12)).toBeCloseTo(-0.5);
    expect(applyDeadzone(1.4, 0.12)).toBe(1);
  });

  it("clamps corrupt or out-of-range frames before simulation", () => {
    expect(sanitizeVehicleInput({
      drive: 4,
      steer: Number.NaN,
      brake: -2,
      handbrake: 3,
      recover: true,
    })).toEqual({ drive: 1, steer: 0, brake: 0, handbrake: 1, recover: true });
  });

  it("maps A/left to negative steering and D/right to positive steering", () => {
    const target = new EventTarget();
    const input = new BrowserVehicleInput(target as Window);
    try {
      target.dispatchEvent(keyboardEvent("keydown", "KeyA"));
      expect(input.sample([]).steer).toBe(-1);
      target.dispatchEvent(keyboardEvent("keyup", "KeyA"));
      target.dispatchEvent(keyboardEvent("keydown", "KeyD"));
      expect(input.sample([]).steer).toBe(1);
    } finally {
      input.dispose();
    }
  });
});
