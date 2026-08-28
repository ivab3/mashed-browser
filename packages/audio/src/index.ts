import type { AudioCue, RuntimeEventBus } from "@mashed/core";

const CUE_FREQUENCIES: Readonly<Record<AudioCue, number>> = {
  menu: 330,
  "race-start": 660,
  "race-finish": 440,
  impact: 110,
  break: 180,
  pickup: 880,
  "weapon-fire": 240,
  "vehicle-destroyed": 72,
  pause: 260,
  resume: 520,
};

const CUE_SAMPLE_NAMES: Readonly<Record<AudioCue, readonly string[]>> = {
  menu: ["menu navigation"],
  "race-start": ["go"],
  "race-finish": ["menu selection"],
  impact: ["impact with barrier", "impact with other vehicle 1"],
  break: ["impact with crate", "debris"],
  pickup: ["flash", "menu selection"],
  "weapon-fire": ["machineg"],
  "vehicle-destroyed": ["explosion1"],
  pause: ["menu navigation"],
  resume: ["menu selection"],
};

const ENGINE_SAMPLE_BY_VEHICLE: Readonly<Record<string, string>> = {
  "vehicle-one": "eng1",
  "vehicle-two": "eng2",
  "vehicle-three": "eng3",
  "vehicle-four": "eng4",
};

export interface EngineVoice {
  id: string;
  normalizedSpeed: number;
  throttle: number;
}

export interface Pcm16AudioSample {
  name: string;
  sampleRate: number;
  channelCount: number;
  pcm16: Int16Array;
}

interface EngineVoiceNodes {
  source: AudioScheduledSourceNode;
  pitch: AudioParam;
  gain: GainNode;
  targetGain: number;
  originalSample: boolean;
}

function normalizedSampleName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

/** Event-driven Web Audio adapter with synthesized fallbacks for missing user-owned samples. */
export class AudioRuntime {
  readonly #unsubscribe: () => void;
  readonly #engineVoices = new Map<string, EngineVoiceNodes>();
  readonly #samples = new Map<string, Pcm16AudioSample>();
  readonly #buffers = new Map<string, AudioBuffer>();
  #context: AudioContext | undefined;
  #paused = false;

  constructor(events: RuntimeEventBus) {
    this.#unsubscribe = events.subscribe((event) => {
      if (event.type === "audio:cue") {
        this.#play(event.cue, event.gain, event.sampleName);
      } else if (event.type === "runtime:state-changed") {
        this.setPaused(event.to === "paused");
        if (event.to === "menu" || event.to === "results") {
          this.setEngineVoices([]);
        }
      }
    });
  }

  get originalSampleCount(): number {
    return this.#samples.size;
  }

  addSampleBank(samples: readonly Pcm16AudioSample[]): number {
    let accepted = 0;
    for (const sample of samples) {
      const name = normalizedSampleName(sample.name);
      if (
        name.length === 0
        || !Number.isFinite(sample.sampleRate)
        || sample.sampleRate <= 0
        || !Number.isInteger(sample.channelCount)
        || sample.channelCount <= 0
        || sample.channelCount > 8
        || sample.pcm16.length === 0
        || sample.pcm16.length % sample.channelCount !== 0
      ) {
        continue;
      }
      this.#samples.set(name, { ...sample, name });
      accepted += 1;
    }
    this.#rebuildBuffers();
    return accepted;
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
    const context = this.#context;
    if (!context) {
      return;
    }
    for (const voice of this.#engineVoices.values()) {
      voice.gain.gain.setTargetAtTime(paused ? 0 : voice.targetGain, context.currentTime, 0.035);
    }
  }

  setEngineVoices(voices: readonly EngineVoice[]): void {
    const context = this.#context;
    if (!context || context.state !== "running") {
      return;
    }
    const present = new Set<string>();
    for (const voice of voices) {
      if (
        voice.id.length === 0
        || !Number.isFinite(voice.normalizedSpeed)
        || !Number.isFinite(voice.throttle)
      ) {
        continue;
      }
      present.add(voice.id);
      let nodes = this.#engineVoices.get(voice.id);
      if (!nodes) {
        nodes = this.#createEngineVoice(voice.id, context);
        this.#engineVoices.set(voice.id, nodes);
      }
      const speed = Math.min(1, Math.max(0, voice.normalizedSpeed));
      const throttle = Math.min(1, Math.max(0, voice.throttle));
      nodes.targetGain = nodes.originalSample
        ? 0.012 + throttle * 0.025 + speed * 0.008
        : 0.005 + throttle * 0.013 + speed * 0.004;
      const pitch = nodes.originalSample
        ? 0.72 + speed * 0.75 + throttle * 0.16
        : 62 + speed * 155 + throttle * 28;
      nodes.pitch.setTargetAtTime(pitch, context.currentTime, 0.045);
      nodes.gain.gain.setTargetAtTime(this.#paused ? 0 : nodes.targetGain, context.currentTime, 0.055);
    }
    for (const [id, nodes] of this.#engineVoices) {
      if (present.has(id)) {
        continue;
      }
      this.#stopVoice(nodes, context.currentTime);
      this.#engineVoices.delete(id);
    }
  }

  async unlock(): Promise<void> {
    this.#context ??= new AudioContext();
    this.#rebuildBuffers();
    if (this.#context.state === "suspended") {
      await this.#context.resume();
    }
  }

  #createEngineVoice(id: string, context: AudioContext): EngineVoiceNodes {
    const gain = context.createGain();
    gain.gain.value = 0;
    const sampleName = ENGINE_SAMPLE_BY_VEHICLE[id] ?? "eng1";
    const buffer = this.#buffers.get(sampleName);
    if (buffer) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(gain).connect(context.destination);
      source.start();
      return { source, pitch: source.playbackRate, gain, targetGain: 0, originalSample: true };
    }
    const source = context.createOscillator();
    source.type = "sawtooth";
    source.connect(gain).connect(context.destination);
    source.start();
    return { source, pitch: source.frequency, gain, targetGain: 0, originalSample: false };
  }

  #stopVoice(nodes: EngineVoiceNodes, now: number): void {
    nodes.gain.gain.setTargetAtTime(0, now, 0.025);
    nodes.source.stop(now + 0.12);
  }

  #rebuildBuffers(): void {
    const context = this.#context;
    if (!context) {
      return;
    }
    this.#buffers.clear();
    for (const [name, sample] of this.#samples) {
      const frameCount = sample.pcm16.length / sample.channelCount;
      const buffer = context.createBuffer(sample.channelCount, frameCount, sample.sampleRate);
      for (let channel = 0; channel < sample.channelCount; channel += 1) {
        const target = buffer.getChannelData(channel);
        for (let frame = 0; frame < frameCount; frame += 1) {
          target[frame] = sample.pcm16[frame * sample.channelCount + channel]! / 32_768;
        }
      }
      this.#buffers.set(name, buffer);
    }
    for (const voice of this.#engineVoices.values()) {
      voice.source.stop();
    }
    this.#engineVoices.clear();
  }

  #findBuffer(cue: AudioCue, requestedName: string | undefined): AudioBuffer | undefined {
    const names = requestedName ? [requestedName] : CUE_SAMPLE_NAMES[cue];
    for (const name of names) {
      const buffer = this.#buffers.get(normalizedSampleName(name));
      if (buffer) {
        return buffer;
      }
    }
    return undefined;
  }

  #play(cue: AudioCue, gainValue: number, requestedName?: string): void {
    const context = this.#context;
    if (!context || context.state !== "running") {
      return;
    }
    const gain = context.createGain();
    const now = context.currentTime;
    const originalBuffer = this.#findBuffer(cue, requestedName);
    if (originalBuffer) {
      const source = context.createBufferSource();
      source.buffer = originalBuffer;
      gain.gain.setValueAtTime(Math.max(0, Math.min(1, gainValue * 2.5)), now);
      source.connect(gain).connect(context.destination);
      source.start(now);
      return;
    }
    const oscillator = context.createOscillator();
    oscillator.type = cue === "impact" || cue === "weapon-fire"
      ? "square"
      : cue === "break" || cue === "vehicle-destroyed" ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(CUE_FREQUENCIES[cue], now);
    gain.gain.setValueAtTime(Math.max(0, Math.min(0.3, gainValue)), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.1);
  }

  async dispose(): Promise<void> {
    this.#unsubscribe();
    for (const voice of this.#engineVoices.values()) {
      voice.source.stop();
    }
    this.#engineVoices.clear();
    this.#buffers.clear();
    this.#samples.clear();
    await this.#context?.close();
    this.#context = undefined;
  }
}
