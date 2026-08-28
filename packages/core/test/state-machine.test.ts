import { describe, expect, it } from "vitest";

import { RuntimeEventBus, RuntimeStateMachine, type RuntimeEvent } from "../src/index.js";

describe("RuntimeStateMachine", () => {
  it("follows the boot to results flow and emits plain-data events", () => {
    const events = new RuntimeEventBus();
    const received: RuntimeEvent[] = [];
    events.subscribe((event) => received.push(event));
    const state = new RuntimeStateMachine(events);
    state.transition("loading", "initialize");
    state.transition("menu", "ready");
    state.transition("race", "start");
    state.transition("paused", "pause");
    state.transition("race", "resume");
    state.transition("results", "finish");
    expect(state.state).toBe("results");
    expect(received.map((event) => event.type)).toEqual(Array(6).fill("runtime:state-changed"));
  });

  it("rejects transitions that skip required states", () => {
    const state = new RuntimeStateMachine(new RuntimeEventBus());
    expect(() => state.transition("race", "skip loading")).toThrow("boot -> race");
  });

  it("allows a paused match to resume or return to menu but not finish directly", () => {
    const state = new RuntimeStateMachine(new RuntimeEventBus());
    state.transition("loading", "initialize");
    state.transition("menu", "ready");
    state.transition("race", "start");
    state.transition("paused", "pause");
    expect(state.canTransition("race")).toBe(true);
    expect(state.canTransition("menu")).toBe(true);
    expect(() => state.transition("results", "skip race")).toThrow("paused -> results");
  });
});
