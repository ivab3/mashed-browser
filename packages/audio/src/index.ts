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

export interface EngineVoice {
  id: string;
  normalizedSpeed: number;
  throttle: number;
}

interface EngineVoiceNodes {
  oscillator: OscillatorNode;
  gain: GainNode;
  targetGain: number;
}

/** Event-driven Web Audio shell. Original game sound decoding starts in a later stage. */
export class AudioRuntime {
  readonly #unsubscribe: () => void;
  readonly #engineVoices = new Map<string, EngineVoiceNodes>();
  #context: AudioContext | undefined;
  #paused = false;

  constructor(events: RuntimeEventBus) {
    this.#unsubscribe = events.subscribe((event) => {
      if (event.type === "audio:cue") {
        this.#play(event.cue, event.gain);
      } else if (event.type === "runtime:state-changed") {
        this.setPaused(event.to === "paused");
        if (event.to === "menu" || event.to === "results") {
          this.setEngineVoices([]);
        }
      }
    });
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
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sawtooth";
        gain.gain.value = 0;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start();
        nodes = { oscillator, gain, targetGain: 0 };
        this.#engineVoices.set(voice.id, nodes);
      }
      const speed = Math.min(1, Math.max(0, voice.normalizedSpeed));
      const throttle = Math.min(1, Math.max(0, voice.throttle));
      nodes.targetGain = 0.005 + throttle * 0.013 + speed * 0.004;
      nodes.oscillator.frequency.setTargetAtTime(62 + speed * 155 + throttle * 28, context.currentTime, 0.045);
      nodes.gain.gain.setTargetAtTime(this.#paused ? 0 : nodes.targetGain, context.currentTime, 0.055);
    }
    for (const [id, nodes] of this.#engineVoices) {
      if (present.has(id)) {
        continue;
      }
      nodes.gain.gain.setTargetAtTime(0, context.currentTime, 0.025);
      nodes.oscillator.stop(context.currentTime + 0.12);
      this.#engineVoices.delete(id);
    }
  }

  async unlock(): Promise<void> {
    this.#context ??= new AudioContext();
    if (this.#context.state === "suspended") {
      await this.#context.resume();
    }
  }

  #play(cue: AudioCue, gainValue: number): void {
    const context = this.#context;
    if (!context || context.state !== "running") {
      return;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
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
      voice.oscillator.stop();
    }
    this.#engineVoices.clear();
    await this.#context?.close();
    this.#context = undefined;
  }
}
