const UINT32_RANGE = 0x1_0000_0000;

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new RangeError("seed must be finite");
  }
  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? 0x6d2b_79f5 : normalized;
}

/** A small, serializable xorshift32 generator for gameplay decisions. */
export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = normalizeSeed(seed);
  }

  get state(): number {
    return this.#state;
  }

  restore(state: number): void {
    this.#state = normalizeSeed(state);
  }

  nextUint32(): number {
    let value = this.#state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#state = value >>> 0;
    return this.#state;
  }

  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  range(minimum: number, maximum: number): number {
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum) {
      throw new RangeError("random range must have finite minimum <= maximum");
    }
    return minimum + (maximum - minimum) * this.nextFloat();
  }

  integer(minimum: number, maximumExclusive: number): number {
    if (!Number.isInteger(minimum) || !Number.isInteger(maximumExclusive) || maximumExclusive <= minimum) {
      throw new RangeError("integer range must contain at least one integer");
    }
    const span = maximumExclusive - minimum;
    if (span > UINT32_RANGE) {
      throw new RangeError("integer range cannot exceed 2^32 values");
    }
    const rejectionLimit = UINT32_RANGE - (UINT32_RANGE % span);
    let sample = this.nextUint32();
    while (sample >= rejectionLimit) {
      sample = this.nextUint32();
    }
    return minimum + (sample % span);
  }
}
