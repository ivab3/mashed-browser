import { describe, expect, it } from "vitest";

import { transferablesIn } from "../src/transferables.js";

describe("transferablesIn", () => {
  it("deduplicates shared typed-array buffers and tolerates cyclic DTOs", () => {
    const shared = new ArrayBuffer(32);
    const separate = new ArrayBuffer(8);
    const dto: Record<string, unknown> = {
      positions: new Float32Array(shared, 0, 4),
      colors: new Uint8Array(shared, 16, 8),
      nested: [{ indices: new Uint16Array(separate) }],
    };
    dto["cycle"] = dto;
    expect(new Set(transferablesIn(dto))).toEqual(new Set([shared, separate]));
  });
});
