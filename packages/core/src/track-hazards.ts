import type { TrackVector3 } from "./lap-session.js";

/** Alpha tuning, not reconstructed original explosion profiles. */
export const ALPHA_BARREL_EXPLOSION = Object.freeze({
  fuseSeconds: 0.35, radiusMeters: 5, damage: 55, knockbackImpulse: 9_000,
});

export interface TrackHazardDefinition {
  id: string;
  position: TrackVector3;
  fuseSeconds: number;
  radiusMeters: number;
  damage: number;
  knockbackImpulse: number;
}

export interface TrackHazardImpact {
  id: string;
  position: TrackVector3;
}

export type TrackHazardEvent =
  | { type: "hazard-triggered"; id: string; position: TrackVector3; cause: "impact" | "chain" }
  | { type: "hazard-exploded"; id: string; position: TrackVector3; radiusMeters: number; damage: number; knockbackImpulse: number };

interface HazardState {
  definition: TrackHazardDefinition;
  position: TrackVector3;
  phase: "armed" | "fusing" | "spent";
  detonateAt: number;
}

function assertPosition(position: TrackVector3): void {
  if (position.length !== 3 || position.some((value) => !Number.isFinite(value))) {
    throw new Error("Track hazard position must contain three finite coordinates");
  }
}

function distance(left: TrackVector3, right: TrackVector3): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

/** Impact -> timed warning -> radial blast -> delayed chain. No wall clock or Lua execution. */
export class TrackHazardSession {
  readonly #hazards: HazardState[];
  #elapsedSeconds = 0;

  constructor(definitions: readonly TrackHazardDefinition[]) {
    const ids = new Set<string>();
    this.#hazards = definitions.map((definition): HazardState => {
      if (!definition.id || ids.has(definition.id)) throw new Error("Track hazard ids must be nonempty and unique");
      ids.add(definition.id);
      assertPosition(definition.position);
      for (const field of ["fuseSeconds", "radiusMeters", "damage", "knockbackImpulse"] as const) {
        if (!Number.isFinite(definition[field]) || definition[field] <= 0) {
          throw new Error(`Track hazard ${field} must be finite and positive`);
        }
      }
      return {
        definition: { ...definition, position: [...definition.position] },
        position: [...definition.position], phase: "armed" as const, detonateAt: 0,
      };
    }).sort((left, right) => left.definition.id < right.definition.id ? -1 : 1);
  }

  get snapshot() {
    return {
      elapsedSeconds: this.#elapsedSeconds,
      hazards: this.#hazards.map((hazard) => ({
        id: hazard.definition.id, position: [...hazard.position] as TrackVector3, phase: hazard.phase,
        secondsRemaining: hazard.phase === "fusing" ? Math.max(0, hazard.detonateAt - this.#elapsedSeconds) : 0,
      })),
    };
  }

  reset(): void {
    this.#elapsedSeconds = 0;
    for (const hazard of this.#hazards) {
      hazard.position = [...hazard.definition.position];
      hazard.phase = "armed";
      hazard.detonateAt = 0;
    }
  }

  advance(
    stepSeconds: number,
    positions: Readonly<Record<string, TrackVector3 | undefined>> = {},
    impacts: readonly TrackHazardImpact[] = [],
  ): TrackHazardEvent[] {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) throw new Error("Track hazard step must be finite and positive");
    for (const position of Object.values(positions)) if (position) assertPosition(position);
    for (const impact of impacts) {
      assertPosition(impact.position);
      if (!this.#hazards.some((hazard) => hazard.definition.id === impact.id)) {
        throw new Error(`Unknown track hazard ${impact.id}`);
      }
    }
    const events: TrackHazardEvent[] = [];
    // Sample moving props before processing impacts. A broken prop keeps its impact location.
    for (const hazard of this.#hazards) {
      const position = positions[hazard.definition.id];
      if (position && hazard.phase !== "spent") hazard.position = [...position];
      const impact = impacts.find((candidate) => candidate.id === hazard.definition.id);
      if (impact && hazard.phase === "armed") {
        hazard.position = [...impact.position];
        this.#trigger(hazard, "impact", events);
      }
    }
    this.#elapsedSeconds += stepSeconds;
    // Freeze this step's due set: chained objects always receive their full warning interval.
    const due = this.#hazards.filter((hazard) => hazard.phase === "fusing"
      && hazard.detonateAt <= this.#elapsedSeconds + 1e-9);
    for (const hazard of due) {
      hazard.phase = "spent";
      const { id, radiusMeters, damage, knockbackImpulse } = hazard.definition;
      events.push({ type: "hazard-exploded", id, position: [...hazard.position], radiusMeters, damage, knockbackImpulse });
      for (const other of this.#hazards) {
        if (other.phase === "armed" && distance(hazard.position, other.position) <= radiusMeters) {
          this.#trigger(other, "chain", events);
        }
      }
    }
    return events;
  }

  #trigger(hazard: HazardState, cause: "impact" | "chain", events: TrackHazardEvent[]): void {
    hazard.phase = "fusing";
    hazard.detonateAt = this.#elapsedSeconds + hazard.definition.fuseSeconds;
    events.push({ type: "hazard-triggered", id: hazard.definition.id, position: [...hazard.position], cause });
  }
}
