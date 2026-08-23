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
    state.transition("results", "finish");
    expect(state.state).toBe("results");
    expect(received.map((event) => event.type)).toEqual(Array(4).fill("runtime:state-changed"));
  });

  it("rejects transitions that skip required states", () => {
    const state = new RuntimeStateMachine(new RuntimeEventBus());
    expect(() => state.transition("race", "skip loading")).toThrow("boot -> race");
  });
});
