export type RuntimeState = "boot" | "loading" | "menu" | "race" | "results";

export type AudioCue = "menu" | "race-start" | "race-finish" | "impact" | "break";

export type RuntimeEvent =
  | {
      type: "runtime:state-changed";
      from: RuntimeState;
      to: RuntimeState;
      reason: string;
    }
  | {
      type: "runtime:focus-changed";
      focused: boolean;
    }
  | {
      type: "simulation:overrun";
      droppedSeconds: number;
      simulationStep: number;
    }
  | {
      type: "physics:contact";
      colliderA: number;
      colliderB: number;
      started: boolean;
    }
  | {
      type: "physics:object-destroyed";
      id: string;
      impactForce: number;
      position: readonly [number, number, number];
    }
  | {
      type: "audio:cue";
      cue: AudioCue;
      gain: number;
    }
  | {
      type: "renderer:flash";
      color: number;
      durationSeconds: number;
    };

export type RuntimeEventListener = (event: RuntimeEvent) => void;

/**
 * A synchronous boundary shared by core, physics, audio, and rendering.
 * Events are intentionally plain data so they can later cross a Worker boundary.
 */
export class RuntimeEventBus {
  readonly #listeners = new Set<RuntimeEventListener>();

  emit(event: RuntimeEvent): void {
    for (const listener of [...this.#listeners]) {
      listener(event);
    }
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  clear(): void {
    this.#listeners.clear();
  }
}
