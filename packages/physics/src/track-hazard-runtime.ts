import {
  TrackHazardSession, type CombatSession, type CombatPlayerFrames, type CombatEvent,
  type TrackHazardDefinition, type TrackHazardImpact,
} from "@mashed/core";
import type { PhysicsRuntime } from "./index.js";

/** Shared browser/test bridge. The caller advances it only during unpaused racing. */
export class TrackHazardRuntime {
  readonly #session: TrackHazardSession;
  readonly #physics: Pick<PhysicsRuntime, "sceneObjects" | "impactSceneObject">;
  readonly #ids: Set<string>;
  #impacts: TrackHazardImpact[] = [];

  constructor(definitions: readonly TrackHazardDefinition[], physics: Pick<PhysicsRuntime, "sceneObjects" | "impactSceneObject">) {
    this.#session = new TrackHazardSession(definitions);
    this.#physics = physics;
    this.#ids = new Set(definitions.map((definition) => definition.id));
  }

  get snapshot() { return this.#session.snapshot; }

  recordImpact(impact: TrackHazardImpact): void {
    if (this.#ids.has(impact.id)) this.#impacts.push({ ...impact, position: [...impact.position] });
  }

  reset(): void {
    this.#impacts = [];
    this.#session.reset();
  }

  advance(stepSeconds: number, combat: CombatSession, frames: CombatPlayerFrames) {
    const impacts = this.#impacts;
    this.#impacts = [];
    const positions = Object.fromEntries(this.#physics.sceneObjects
      .filter((object) => this.#ids.has(object.id)).map((object) => [object.id, object.history.current.position]));
    const hazardEvents = this.#session.advance(stepSeconds, positions, impacts);
    const combatEvents: CombatEvent[] = [];
    for (const event of hazardEvents) {
      if (event.type !== "hazard-exploded") continue;
      this.#physics.impactSceneObject(event.id, [0, 0, 0], true);
      combatEvents.push(...combat.applyEnvironmentBlast(event, frames));
    }
    return { hazardEvents, combatEvents };
  }
}
