import type { RuntimeEventBus } from "./events.js";

export interface FixedStepOptions {
  stepSeconds?: number;
  maxFrameSeconds?: number;
  maxSubSteps?: number;
  events?: RuntimeEventBus;
}

export interface FixedStepFrame {
  frameDeltaSeconds: number;
  simulatedSteps: number;
  simulationStep: number;
  interpolationAlpha: number;
  droppedSeconds: number;
}

const DEFAULT_STEP_SECONDS = 1 / 60;
const DEFAULT_MAX_FRAME_SECONDS = 0.25;
const DEFAULT_MAX_SUB_STEPS = 8;
const STEP_EPSILON = 1e-9;

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
  return value;
}

/**
 * Converts an arbitrary presentation clock into stable simulation ticks.
 * Long frames are clamped and excess catch-up work is deliberately discarded.
 */
export class FixedStepClock {
  readonly stepSeconds: number;
  readonly maxFrameSeconds: number;
  readonly maxSubSteps: number;
  readonly #events: RuntimeEventBus | undefined;

  #lastTimestampSeconds: number | undefined;
  #accumulatorSeconds = 0;
  #simulationStep = 0;

  constructor(options: FixedStepOptions = {}) {
    this.stepSeconds = positiveFinite(options.stepSeconds ?? DEFAULT_STEP_SECONDS, "stepSeconds");
    this.maxFrameSeconds = positiveFinite(
      options.maxFrameSeconds ?? DEFAULT_MAX_FRAME_SECONDS,
      "maxFrameSeconds",
    );
    this.maxSubSteps = Math.floor(positiveFinite(options.maxSubSteps ?? DEFAULT_MAX_SUB_STEPS, "maxSubSteps"));
    this.#events = options.events;
  }

  get simulationStep(): number {
    return this.#simulationStep;
  }

  reset(timestampSeconds?: number): void {
    if (timestampSeconds !== undefined && !Number.isFinite(timestampSeconds)) {
      throw new RangeError("timestampSeconds must be finite");
    }
    this.#lastTimestampSeconds = timestampSeconds;
    this.#accumulatorSeconds = 0;
  }

  restart(timestampSeconds?: number): void {
    this.#simulationStep = 0;
    this.reset(timestampSeconds);
  }

  advance(timestampSeconds: number, simulate: (stepSeconds: number, step: number) => void): FixedStepFrame {
    if (!Number.isFinite(timestampSeconds)) {
      throw new RangeError("timestampSeconds must be finite");
    }
    const lastTimestamp = this.#lastTimestampSeconds;
    this.#lastTimestampSeconds = timestampSeconds;
    if (lastTimestamp === undefined || timestampSeconds < lastTimestamp) {
      this.#accumulatorSeconds = 0;
      return this.#frame(0, 0, 0);
    }

    const rawFrameSeconds = timestampSeconds - lastTimestamp;
    const frameDeltaSeconds = Math.min(rawFrameSeconds, this.maxFrameSeconds);
    let droppedSeconds = Math.max(0, rawFrameSeconds - frameDeltaSeconds);
    this.#accumulatorSeconds += frameDeltaSeconds;

    const availableSteps = Math.floor((this.#accumulatorSeconds + STEP_EPSILON) / this.stepSeconds);
    const simulatedSteps = Math.min(availableSteps, this.maxSubSteps);
    for (let index = 0; index < simulatedSteps; index += 1) {
      simulate(this.stepSeconds, this.#simulationStep);
      this.#simulationStep += 1;
    }
    this.#accumulatorSeconds -= simulatedSteps * this.stepSeconds;

    const skippedSteps = availableSteps - simulatedSteps;
    if (skippedSteps > 0) {
      const skippedSeconds = skippedSteps * this.stepSeconds;
      this.#accumulatorSeconds -= skippedSeconds;
      droppedSeconds += skippedSeconds;
    }
    if (this.#accumulatorSeconds < 0 && this.#accumulatorSeconds > -STEP_EPSILON) {
      this.#accumulatorSeconds = 0;
    }

    if (droppedSeconds > 0) {
      this.#events?.emit({
        type: "simulation:overrun",
        droppedSeconds,
        simulationStep: this.#simulationStep,
      });
    }
    return this.#frame(frameDeltaSeconds, simulatedSteps, droppedSeconds);
  }

  #frame(frameDeltaSeconds: number, simulatedSteps: number, droppedSeconds: number): FixedStepFrame {
    return {
      frameDeltaSeconds,
      simulatedSteps,
      simulationStep: this.#simulationStep,
      interpolationAlpha: Math.min(1, Math.max(0, this.#accumulatorSeconds / this.stepSeconds)),
      droppedSeconds,
    };
  }
}
