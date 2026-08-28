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
};

/** Event-driven Web Audio shell. Original game sound decoding starts in a later stage. */
export class AudioRuntime {
  readonly #unsubscribe: () => void;
  #context: AudioContext | undefined;

  constructor(events: RuntimeEventBus) {
    this.#unsubscribe = events.subscribe((event) => {
      if (event.type === "audio:cue") {
        this.#play(event.cue, event.gain);
      }
    });
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
    await this.#context?.close();
    this.#context = undefined;
  }
}
