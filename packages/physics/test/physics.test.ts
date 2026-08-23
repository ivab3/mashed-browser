import { RuntimeEventBus } from "@mashed/core";
import { describe, expect, it } from "vitest";

import { createPhysicsRuntime } from "../src/index.js";

describe("PhysicsRuntime", () => {
  it("uses a fixed timestep and repeats the same local simulation", async () => {
    const first = await createPhysicsRuntime(new RuntimeEventBus());
    const second = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      for (let step = 0; step < 180; step += 1) {
        first.step(1 / 60);
        second.step(1 / 60);
      }
      expect(first.transformHistory.current).toEqual(second.transformHistory.current);
      expect(first.metrics).toEqual(second.metrics);
      expect(first.debugLines().vertices.length).toBeGreaterThan(0);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("rejects a variable physics timestep", async () => {
    const physics = await createPhysicsRuntime(new RuntimeEventBus());
    try {
      expect(() => physics.step(1 / 30)).toThrow("Physics timestep changed");
    } finally {
      physics.dispose();
    }
  });
});
