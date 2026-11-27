import { RuntimeEventBus } from "@mashed/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioRuntime } from "../src/index.js";

class FakeParam {
  value = 1;
  setValueAtTime = vi.fn((value: number) => { this.value = value; });
  setTargetAtTime = vi.fn((value: number) => { this.value = value; });
  exponentialRampToValueAtTime = vi.fn();
}

class FakeNode {
  connections: FakeNode[] = [];
  gain = new FakeParam();
  frequency = new FakeParam();
  playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  connect(node: FakeNode) { this.connections.push(node); return node; }
  disconnect = vi.fn(() => { this.connections = []; });
  start = vi.fn();
  stop = vi.fn();
}

class FakeContext {
  state = "running";
  currentTime = 4;
  destination = new FakeNode();
  gains: FakeNode[] = [];
  sources: FakeNode[] = [];
  createGain() { const node = new FakeNode(); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeNode(); this.sources.push(node); return node; }
  createBufferSource() { return this.createOscillator(); }
  createBuffer(_channels: number, frames: number) {
    return { getChannelData: () => new Float32Array(frames) };
  }
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
}

afterEach(() => vi.unstubAllGlobals());

function createRuntime() {
  const context = new FakeContext();
  vi.stubGlobal("AudioContext", function () { return context; });
  const events = new RuntimeEventBus();
  return { context, events, runtime: new AudioRuntime(events) };
}

describe("AudioRuntime master volume", () => {
  it("allocates each requested sample once and invalidates only replaced samples", async () => {
    const { context, events, runtime } = createRuntime();
    const allocate = vi.spyOn(context, "createBuffer");
    const sample = { name: "menu navigation", sampleRate: 22050, channelCount: 1, pcm16: new Int16Array(4) };
    runtime.addSampleBank([sample, { ...sample, name: "eng1" }, { ...sample, name: "go" }]);
    await runtime.unlock();
    expect(allocate).not.toHaveBeenCalled();
    const cue = () => events.emit({ type: "audio:cue", cue: "menu", gain: 0.1 });
    cue();
    cue();
    const voices = [{ id: "vehicle-one", normalizedSpeed: 0, throttle: 1 }];
    runtime.setEngineVoices(voices);
    await runtime.unlock();
    runtime.setEngineVoices(voices);
    expect(allocate).toHaveBeenCalledTimes(2);
    const engine = context.sources.at(-1)!;
    runtime.addSampleBank([{ ...sample, pcm16: new Int16Array(8) }]);
    cue();
    expect(allocate).toHaveBeenLastCalledWith(1, 8, 22050);
    runtime.setEngineVoices(voices);
    expect(engine.stop).not.toHaveBeenCalled();
    expect(allocate).toHaveBeenCalledTimes(3);
    await runtime.dispose();
  });

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

  it.each([false, true])("routes already-playing cues through the live master bus (original=%s)", async (original) => {
    const { context, events, runtime } = createRuntime();
    runtime.setMasterVolume(0.35);
    if (original) {
      runtime.addSampleBank([{ name: "menu navigation", sampleRate: 22050, channelCount: 1, pcm16: new Int16Array(22050) }]);
    }
    await runtime.unlock();
    events.emit({ type: "audio:cue", cue: "menu", gain: 0.08 });
    const [master, cue] = context.gains;
    const source = context.sources[0]!;
    expect(master!.gain.value).toBe(0.35);
    expect(master!.connections).toEqual([context.destination]);
    expect(source.connections).toEqual([cue]);
    expect(cue!.connections).toEqual([master]);
    expect(cue!.gain.value).toBeCloseTo(original ? 0.2 : 0.08);
    runtime.setMasterVolume(0);
    expect(master!.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 4);
    expect(source.stop).toHaveBeenCalledTimes(original ? 0 : 1);
    runtime.setMasterVolume(0.6);
    expect(master!.gain.value).toBe(0.6);
    expect(context.sources).toHaveLength(1);
    source.onended!();
    expect(source.disconnect).toHaveBeenCalledOnce();
    expect(cue!.disconnect).toHaveBeenCalledOnce();
    await runtime.dispose();
    expect(master!.disconnect).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("scales engines exactly once and preserves pause across volume changes", async () => {
    const { context, runtime } = createRuntime();
    await runtime.unlock();
    runtime.setMasterVolume(0.4);
    runtime.setEngineVoices([{ id: "vehicle-one", normalizedSpeed: 0, throttle: 1 }]);
    const [master, engine] = context.gains;
    expect(engine!.connections).toEqual([master]);
    expect(engine!.gain.value).toBeCloseTo(0.018);
    runtime.setPaused(true);
    expect(engine!.gain.value).toBe(0);
    runtime.setMasterVolume(0.8);
    expect(engine!.gain.value).toBe(0);
    runtime.setPaused(false);
    expect(engine!.gain.value).toBeCloseTo(0.018);
    expect(master!.gain.value).toBe(0.8);
    runtime.setEngineVoices([]);
    expect(context.sources[0]!.stop).toHaveBeenCalledOnce();
    await runtime.dispose();
  });

  it("does not create invalid zero-gain ramps or duplicate master buses on repeated unlock", async () => {
    const { context, events, runtime } = createRuntime();
    context.state = "suspended";
    await runtime.unlock();
    await runtime.unlock();
    expect(context.gains).toHaveLength(1);
    expect(context.resume).toHaveBeenCalledOnce();
    for (const gain of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      events.emit({ type: "audio:cue", cue: "menu", gain });
    }
    runtime.setMasterVolume(0);
    events.emit({ type: "audio:cue", cue: "menu", gain: 0.08 });
    expect(context.sources).toHaveLength(0);
    await runtime.dispose();
    events.emit({ type: "audio:cue", cue: "menu", gain: 0.08 });
    expect(context.sources).toHaveLength(0);
  });
});
