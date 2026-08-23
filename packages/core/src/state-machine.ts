import type { RuntimeEventBus, RuntimeState } from "./events.js";

const ALLOWED_TRANSITIONS: Readonly<Record<RuntimeState, ReadonlySet<RuntimeState>>> = {
  boot: new Set(["loading"]),
  loading: new Set(["menu"]),
  menu: new Set(["loading", "race"]),
  race: new Set(["results", "menu"]),
  results: new Set(["menu", "loading", "race"]),
};

export class RuntimeStateMachine {
  #state: RuntimeState = "boot";
  readonly #events: RuntimeEventBus;

  constructor(events: RuntimeEventBus) {
    this.#events = events;
  }

  get state(): RuntimeState {
    return this.#state;
  }

  canTransition(to: RuntimeState): boolean {
    return ALLOWED_TRANSITIONS[this.#state].has(to);
  }

  transition(to: RuntimeState, reason: string): void {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid runtime transition ${this.#state} -> ${to}`);
    }
    const from = this.#state;
    this.#state = to;
    this.#events.emit({ type: "runtime:state-changed", from, to, reason });
  }
}
