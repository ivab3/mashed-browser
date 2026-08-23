import { describe, expect, it } from "vitest";

import { FixedStepClock, RuntimeEventBus } from "../src/index.js";

describe("FixedStepClock", () => {
  it.each([30, 60, 120])("runs exactly 60 simulation steps at %d Hz", (refreshRate) => {
    const clock = new FixedStepClock();
    let ticks = 0;
    clock.advance(0, () => undefined);
    for (let frame = 1; frame <= refreshRate; frame += 1) {
      clock.advance(frame / refreshRate, () => {
        ticks += 1;
      });
    }
    expect(ticks).toBe(60);
    expect(clock.simulationStep).toBe(60);
  });

  it("caps catch-up work and reports discarded time", () => {
    const events = new RuntimeEventBus();
    const overruns: number[] = [];
    events.subscribe((event) => {
      if (event.type === "simulation:overrun") {
        overruns.push(event.droppedSeconds);
      }
    });
    const clock = new FixedStepClock({ events, maxSubSteps: 4, maxFrameSeconds: 0.25 });
    let ticks = 0;
    clock.advance(0, () => undefined);
    const frame = clock.advance(2, () => {
      ticks += 1;
    });
    expect(ticks).toBe(4);
    expect(frame.droppedSeconds).toBeGreaterThan(1.9);
    expect(overruns).toEqual([frame.droppedSeconds]);
    expect(frame.interpolationAlpha).toBeLessThan(1);
  });

  it("does not catch up time elapsed while focus was lost", () => {
    const clock = new FixedStepClock();
    let ticks = 0;
    clock.advance(1, () => undefined);
    clock.advance(1.02, () => {
      ticks += 1;
    });
    clock.reset(20);
    clock.advance(20.016, () => {
      ticks += 1;
    });
    expect(ticks).toBe(1);
  });
});
