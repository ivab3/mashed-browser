import {
  RuntimeEventBus,
  RuntimeStateMachine,
  type CombatSnapshot,
  type RuntimeEvent,
} from "@mashed/core";

import type { MatchReplayEvent, MatchReplayOutcome } from "./match-replay.js";
import { runMatchReplay } from "./match-replay.js";
import { createStageFiveReplayScenario } from "./stage-five-scenario.js";

const DEFAULT_SOAK_SECONDS = 30 * 60;
const REFRESH_RATES = [30, 60, 120] as const;

interface ActiveEffect {
  expiresAtStep: number;
  particles: number;
}

export interface StageFiveSoakOptions {
  simulatedSeconds?: number;
  measureHeap?: boolean;
}

export interface StageFiveSoakReport {
  requestedSimulatedSeconds: number;
  simulatedSeconds: number;
  matches: number;
  fixedSteps: number;
  stateTransitions: number;
  pausedMatches: number;
  refreshRates: readonly number[];
  maximumProjectiles: number;
  maximumRuntimeObjects: number;
  maximumConcurrentBursts: number;
  maximumConcurrentParticles: number;
  heapGrowthBytes: number | null;
  deterministicResets: true;
  finiteSnapshots: true;
  legalStateTransitions: true;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Stage 5 soak invariant failed: ${message}`);
  }
}

function assertFiniteNumbers(value: unknown, path = "snapshot"): void {
  if (typeof value === "number") {
    invariant(Number.isFinite(value), `${path} is not finite`);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertFiniteNumbers(entry, `${path}.${key}`);
  }
}

function assertCombatBounds(snapshot: CombatSnapshot): void {
  invariant(snapshot.players.length === 4, "combat roster changed size");
  invariant(snapshot.pickups.length === 2, "combat pickup set changed size");
  for (const player of snapshot.players) {
    invariant(player.health >= 0 && player.health <= player.maximumHealth, `${player.id} health escaped bounds`);
    invariant(!player.destroyed || player.health === 0, `${player.id} is destroyed with non-zero health`);
    invariant(!player.inventory || player.inventory.ammo >= 0, `${player.id} has negative ammo`);
  }
}

function particleBurst(event: MatchReplayEvent): { particles: number; durationSeconds: number } | undefined {
  if (event.source !== "combat") {
    return undefined;
  }
  switch (event.event.type) {
    case "pickup-collected":
      return { particles: 14, durationSeconds: 0.45 };
    case "weapon-fired":
      return {
        particles: event.event.weapon === "machine-gun" ? 5 : 9,
        durationSeconds: 0.24,
      };
    case "player-damaged":
      return { particles: 12, durationSeconds: 0.42 };
    case "player-destroyed":
      return { particles: 36, durationSeconds: 0.9 };
    case "projectile-world-impact":
      return {
        particles: event.event.weapon === "machine-gun" ? 8 : 30,
        durationSeconds: event.event.weapon === "machine-gun" ? 0.3 : 0.8,
      };
    case "pickup-respawned":
    case "projectile-expired":
      return undefined;
  }
}

class SoakBudgetTracker {
  readonly #stepSeconds: number;
  readonly #effects: ActiveEffect[] = [];
  maximumProjectiles = 0;
  maximumRuntimeObjects = 0;
  maximumConcurrentBursts = 0;
  maximumConcurrentParticles = 0;

  constructor(stepSeconds: number) {
    this.#stepSeconds = stepSeconds;
  }

  consumeMatch(matchIndex: number, stepOffset: number, outcome: MatchReplayOutcome): void {
    const projectiles = new Set<number>();
    for (const event of outcome.events) {
      const absoluteStep = stepOffset + event.step;
      this.#expireEffects(absoluteStep);
      const burst = particleBurst(event);
      if (burst) {
        this.#effects.push({
          expiresAtStep: absoluteStep + Math.ceil(burst.durationSeconds / this.#stepSeconds),
          particles: burst.particles,
        });
        this.maximumConcurrentBursts = Math.max(this.maximumConcurrentBursts, this.#effects.length);
        this.maximumConcurrentParticles = Math.max(
          this.maximumConcurrentParticles,
          this.#effects.reduce((sum, effect) => sum + effect.particles, 0),
        );
      }
      if (event.source !== "combat") {
        continue;
      }
      if (event.event.type === "weapon-fired") {
        projectiles.add(event.event.projectileId);
      } else if (
        event.event.type === "projectile-world-impact"
        || event.event.type === "projectile-expired"
      ) {
        projectiles.delete(event.event.projectileId);
      }
      this.maximumProjectiles = Math.max(this.maximumProjectiles, projectiles.size);
      this.maximumRuntimeObjects = Math.max(
        this.maximumRuntimeObjects,
        outcome.combat.players.length + outcome.combat.pickups.length + projectiles.size,
      );
    }
    invariant(
      projectiles.size === outcome.combat.projectiles.length,
      `match ${matchIndex} projectile event ledger diverged from its snapshot`,
    );
    this.#expireEffects(stepOffset + outcome.processedSteps);
  }

  #expireEffects(step: number): void {
    for (let index = this.#effects.length - 1; index >= 0; index -= 1) {
      if (this.#effects[index]!.expiresAtStep <= step) {
        this.#effects.splice(index, 1);
      }
    }
  }
}

function collectHeapBytes(): number | undefined {
  const runtime = globalThis as typeof globalThis & { gc?: () => void };
  runtime.gc?.();
  return typeof process === "undefined" ? undefined : process.memoryUsage().heapUsed;
}

/** Runs repeated complete matches until the requested amount of simulation time has elapsed. */
export function runStageFiveSoak(options: StageFiveSoakOptions = {}): StageFiveSoakReport {
  const requestedSimulatedSeconds = options.simulatedSeconds ?? DEFAULT_SOAK_SECONDS;
  invariant(
    Number.isFinite(requestedSimulatedSeconds) && requestedSimulatedSeconds > 0,
    "simulatedSeconds must be finite and positive",
  );

  const scenario = createStageFiveReplayScenario();
  const baseline = runMatchReplay(scenario.definition, scenario.tape, 60).outcome;
  const baselineJson = JSON.stringify(baseline);
  const matches = Math.ceil(
    requestedSimulatedSeconds / (baseline.processedSteps * scenario.tape.stepSeconds),
  );
  const budget = new SoakBudgetTracker(scenario.tape.stepSeconds);
  const runtimeEvents = new RuntimeEventBus();
  const state = new RuntimeStateMachine(runtimeEvents);
  let stateTransitions = 0;
  let pausedMatches = 0;
  const unsubscribe = runtimeEvents.subscribe((event: RuntimeEvent) => {
    if (event.type === "runtime:state-changed") {
      stateTransitions += 1;
    }
  });
  state.transition("loading", "soak boot");
  state.transition("menu", "soak ready");
  const heapBefore = options.measureHeap ? collectHeapBytes() : undefined;

  let fixedSteps = 0;
  try {
    for (let match = 0; match < matches; match += 1) {
      state.transition("race", `soak match ${match + 1}`);
      if (match % 20 === 0) {
        state.transition("paused", "soak pause");
        state.transition("race", "soak resume");
        pausedMatches += 1;
      }
      const refreshRate = REFRESH_RATES[match % REFRESH_RATES.length]!;
      const outcome = runMatchReplay(scenario.definition, scenario.tape, refreshRate).outcome;
      invariant(JSON.stringify(outcome) === baselineJson, `match ${match + 1} changed after reset`);
      assertFiniteNumbers(outcome);
      assertCombatBounds(outcome.combat);
      invariant(outcome.race.phase === "finished", `match ${match + 1} did not finish`);
      invariant(outcome.race.results.length === 4, `match ${match + 1} result roster changed size`);
      invariant(
        outcome.race.results.every((result, index) => result.rank === index + 1),
        `match ${match + 1} result ranks are not contiguous`,
      );
      budget.consumeMatch(match + 1, fixedSteps, outcome);
      fixedSteps += outcome.processedSteps;
      state.transition("results", `soak match ${match + 1} complete`);
    }
  } finally {
    unsubscribe();
  }

  const heapAfter = options.measureHeap ? collectHeapBytes() : undefined;
  const heapGrowthBytes = heapBefore === undefined || heapAfter === undefined
    ? null
    : heapAfter - heapBefore;
  const simulatedSeconds = fixedSteps * scenario.tape.stepSeconds;
  invariant(simulatedSeconds >= requestedSimulatedSeconds, "soak ended before requested simulation time");
  invariant(budget.maximumProjectiles <= 12, "projectile count exceeded the weapon ammo budget");
  invariant(budget.maximumRuntimeObjects <= 18, "runtime combat object count escaped its budget");
  invariant(budget.maximumConcurrentBursts <= 8, "renderer burst count escaped its event budget");
  invariant(budget.maximumConcurrentParticles <= 128, "renderer particle count escaped its event budget");
  if (heapGrowthBytes !== null) {
    invariant(heapGrowthBytes < 16 * 1024 * 1024, "retained heap grew by 16 MiB or more");
  }

  return {
    requestedSimulatedSeconds,
    simulatedSeconds,
    matches,
    fixedSteps,
    stateTransitions,
    pausedMatches,
    refreshRates: REFRESH_RATES,
    maximumProjectiles: budget.maximumProjectiles,
    maximumRuntimeObjects: budget.maximumRuntimeObjects,
    maximumConcurrentBursts: budget.maximumConcurrentBursts,
    maximumConcurrentParticles: budget.maximumConcurrentParticles,
    heapGrowthBytes,
    deterministicResets: true,
    finiteSnapshots: true,
    legalStateTransitions: true,
  };
}
