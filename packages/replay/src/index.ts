export interface ReplayTape<TInput> {
  version: 1;
  seed: number;
  stepSeconds: number;
  frames: readonly TInput[];
}

export class ReplayRecorder<TInput> {
  readonly #seed: number;
  readonly #stepSeconds: number;
  readonly #frames: TInput[] = [];

  constructor(seed: number, stepSeconds = 1 / 60) {
    this.#seed = seed;
    this.#stepSeconds = stepSeconds;
  }

  record(input: TInput): void {
    this.#frames.push(structuredClone(input));
  }

  finish(): ReplayTape<TInput> {
    return {
      version: 1,
      seed: this.#seed,
      stepSeconds: this.#stepSeconds,
      frames: structuredClone(this.#frames),
    };
  }
}

export class ReplayCursor<TInput> {
  #index = 0;
  readonly #tape: ReplayTape<TInput>;

  constructor(tape: ReplayTape<TInput>) {
    this.#tape = tape;
  }

  get done(): boolean {
    return this.#index >= this.#tape.frames.length;
  }

  next(): TInput | undefined {
    const frame = this.#tape.frames[this.#index];
    if (frame !== undefined) {
      this.#index += 1;
    }
    return frame;
  }
}
