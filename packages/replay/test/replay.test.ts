import { FixedStepClock, SeededRandom } from "@mashed/core";
import { describe, expect, it } from "vitest";

import { ReplayCursor, ReplayRecorder, type ReplayTape } from "../src/index.js";

interface InputFrame {
  throttle: number;
  steer: number;
}

interface DemoState {
  x: number;
  speed: number;
  heading: number;
  randomState: number;
  steps: number;
}

function makeTape(): ReplayTape<InputFrame> {
  const recorder = new ReplayRecorder<InputFrame>(0x5eed, 1 / 60);
  for (let step = 0; step < 360; step += 1) {
    recorder.record({
      throttle: step < 180 ? 1 : -0.3,
      steer: Math.sin(step / 30) * 0.5,
    });
  }
  return recorder.finish();
}

function runAtRefreshRate(tape: ReplayTape<InputFrame>, refreshRate: number): DemoState {
  const clock = new FixedStepClock({ stepSeconds: tape.stepSeconds });
  const cursor = new ReplayCursor(tape);
  const random = new SeededRandom(tape.seed);
  const state: DemoState = { x: 0, speed: 0, heading: 0, randomState: random.state, steps: 0 };
  const simulate = (stepSeconds: number): void => {
    const input = cursor.next();
    if (!input) {
      return;
    }
    state.speed += input.throttle * 7 * stepSeconds;
    state.heading += input.steer * 1.5 * stepSeconds;
    state.x += Math.cos(state.heading) * state.speed * stepSeconds;
    if (random.nextFloat() < 0.015) {
      state.speed *= 0.98;
    }
    state.randomState = random.state;
    state.steps += 1;
  };
  clock.advance(0, simulate);
  const totalSeconds = tape.frames.length * tape.stepSeconds;
  const frameCount = Math.round(totalSeconds * refreshRate);
  for (let frame = 1; frame <= frameCount; frame += 1) {
    clock.advance(frame / refreshRate, simulate);
  }
  return state;
}

describe("replay determinism", () => {
  it("produces the same result at 30, 60, and 120 Hz presentation rates", () => {
    const tape = makeTape();
    const results = [30, 60, 120].map((refreshRate) => runAtRefreshRate(tape, refreshRate));
    expect(results[0]?.steps).toBe(360);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });
});
