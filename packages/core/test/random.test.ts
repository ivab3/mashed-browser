import { describe, expect, it } from "vitest";

import { SeededRandom } from "../src/index.js";

describe("SeededRandom", () => {
  it("replays the same sequence after restoring state", () => {
    const random = new SeededRandom(0xc0ffee);
    random.nextUint32();
    const snapshot = random.state;
    const expected = Array.from({ length: 8 }, () => random.nextUint32());
    random.restore(snapshot);
    expect(Array.from({ length: 8 }, () => random.nextUint32())).toEqual(expected);
  });

  it("stays within requested ranges", () => {
    const random = new SeededRandom(123);
    for (let index = 0; index < 100; index += 1) {
      expect(random.integer(-2, 4)).toBeGreaterThanOrEqual(-2);
      expect(random.integer(-2, 4)).toBeLessThan(4);
      expect(random.range(10, 11)).toBeGreaterThanOrEqual(10);
      expect(random.range(10, 11)).toBeLessThan(11);
    }
  });
});
