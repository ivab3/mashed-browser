import { RuntimeEventBus } from "@mashed/core";
import { describe, expect, it } from "vitest";

import { AudioRuntime } from "../src/index.js";

describe("AudioRuntime master volume", () => {
  it("stores a safe normalized gain before the browser audio context is unlocked", async () => {
    const runtime = new AudioRuntime(new RuntimeEventBus());
    runtime.setMasterVolume(0.35);
    expect(runtime.masterVolume).toBe(0.35);
    runtime.setMasterVolume(4);
    expect(runtime.masterVolume).toBe(1);
    runtime.setMasterVolume(-2);
    expect(runtime.masterVolume).toBe(0);
    runtime.setMasterVolume(Number.NaN);
    expect(runtime.masterVolume).toBe(1);
    await runtime.dispose();
  });
});
