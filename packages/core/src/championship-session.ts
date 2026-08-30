import { LOCAL_PLAYER_SLOTS } from "./local-roster.js";
import type { MatchModeType } from "./match-mode-session.js";

export type ChampionshipPhase = "event-ready" | "event-complete" | "finished";
export type ChampionshipMedal = "gold" | "silver" | "bronze" | "none";

export interface ChampionshipEntrantDefinition {
  id: string;
  displayName?: string;
}

export interface ChampionshipEventDefinition {
  id: string;
  name: string;
  courseId?: number;
  mode: MatchModeType;
}

export interface ChampionshipDefinition {
  id: string;
  name: string;
  entrants: readonly ChampionshipEntrantDefinition[];
  events: readonly ChampionshipEventDefinition[];
  pointsByRank?: readonly number[];
}

export interface ChampionshipStandingSnapshot {
  rank: number;
  entrantId: string;
  displayName: string;
  points: number;
  eventWins: number;
  cumulativeRank: number;
  lastEventRank: number | null;
  medal: ChampionshipMedal;
}

export interface ChampionshipEventResultSnapshot {
  eventId: string;
  eventName: string;
  ranking: readonly string[];
  awardedPoints: Readonly<Record<string, number>>;
}

export interface ChampionshipSnapshot {
  id: string;
  name: string;
  phase: ChampionshipPhase;
  eventIndex: number;
  eventNumber: number;
  eventCount: number;
  currentEvent: ChampionshipEventDefinition;
  pointsByRank: readonly number[];
  standings: readonly ChampionshipStandingSnapshot[];
  completedEvents: readonly ChampionshipEventResultSnapshot[];
}

export interface ChampionshipSaveV1 {
  version: 1;
  championshipId: string;
  phase: ChampionshipPhase;
  eventIndex: number;
  entrants: readonly {
    id: string;
    points: number;
    eventWins: number;
    cumulativeRank: number;
    lastEventRank: number | null;
  }[];
  completedEvents: readonly ChampionshipEventResultSnapshot[];
}

export type ChampionshipEvent =
  | {
      type: "championship-event-completed";
      eventId: string;
      eventIndex: number;
      ranking: readonly string[];
      awardedPoints: Readonly<Record<string, number>>;
    }
  | { type: "championship-event-advanced"; eventId: string; eventIndex: number }
  | { type: "championship-completed"; winnerId: string; standings: readonly ChampionshipStandingSnapshot[] };

interface ChampionshipEntrantRuntime {
  readonly definition: ChampionshipEntrantDefinition;
  readonly displayName: string;
  readonly initialIndex: number;
  points: number;
  eventWins: number;
  cumulativeRank: number;
  lastEventRank: number | null;
}

const DEFAULT_POINTS_BY_RANK = Object.freeze([5, 3, 2, 1]);

function cloneEventResult(result: ChampionshipEventResultSnapshot): ChampionshipEventResultSnapshot {
  return {
    eventId: result.eventId,
    eventName: result.eventName,
    ranking: [...result.ranking],
    awardedPoints: { ...result.awardedPoints },
  };
}

/** Pure multi-event championship table with explicit event transitions and a versioned save contract. */
export class ChampionshipSession {
  readonly #definition: ChampionshipDefinition;
  readonly #entrants: ChampionshipEntrantRuntime[];
  readonly #pointsByRank: readonly number[];
  readonly #completedEvents: ChampionshipEventResultSnapshot[] = [];
  #phase: ChampionshipPhase = "event-ready";
  #eventIndex = 0;

  constructor(definition: ChampionshipDefinition) {
    if (!definition.id.trim() || !definition.name.trim()) {
      throw new Error("Championship id and name are required");
    }
    if (definition.entrants.length < 2 || definition.entrants.length > LOCAL_PLAYER_SLOTS.length) {
      throw new Error(`Championship needs between 2 and ${LOCAL_PLAYER_SLOTS.length} entrants`);
    }
    if (definition.events.length < 2) {
      throw new Error("Championship needs at least two events");
    }
    const entrantIds = new Set<string>();
    this.#entrants = definition.entrants.map((entrant, initialIndex) => {
      if (!entrant.id || entrantIds.has(entrant.id)) {
        throw new Error(`Championship entrant id ${JSON.stringify(entrant.id)} is empty or duplicated`);
      }
      entrantIds.add(entrant.id);
      return {
        definition: entrant,
        displayName: entrant.displayName ?? entrant.id,
        initialIndex,
        points: 0,
        eventWins: 0,
        cumulativeRank: 0,
        lastEventRank: null,
      };
    });
    const eventIds = new Set<string>();
    for (const event of definition.events) {
      if (!event.id || !event.name.trim() || eventIds.has(event.id)) {
        throw new Error(`Championship event id ${JSON.stringify(event.id)} is empty or duplicated`);
      }
      if (event.courseId !== undefined && (!Number.isInteger(event.courseId) || event.courseId < 0)) {
        throw new Error(`Championship event ${event.id} courseId must be a non-negative integer`);
      }
      eventIds.add(event.id);
    }
    const points = definition.pointsByRank ?? DEFAULT_POINTS_BY_RANK;
    if (points.length < definition.entrants.length) {
      throw new Error("Championship pointsByRank must cover every entrant rank");
    }
    if (points.some((value, index) => (
      !Number.isInteger(value) || value < 0 || (index > 0 && value > points[index - 1]!)
    ))) {
      throw new Error("Championship pointsByRank must be non-negative descending integers");
    }
    this.#pointsByRank = [...points.slice(0, definition.entrants.length)];
    this.#definition = {
      ...definition,
      entrants: definition.entrants.map((entrant) => ({ ...entrant })),
      events: definition.events.map((event) => ({ ...event })),
      pointsByRank: [...this.#pointsByRank],
    };
  }

  static restore(definition: ChampionshipDefinition, save: ChampionshipSaveV1): ChampionshipSession {
    const session = new ChampionshipSession(definition);
    session.#restore(save);
    return session;
  }

  get snapshot(): ChampionshipSnapshot {
    return {
      id: this.#definition.id,
      name: this.#definition.name,
      phase: this.#phase,
      eventIndex: this.#eventIndex,
      eventNumber: this.#eventIndex + 1,
      eventCount: this.#definition.events.length,
      currentEvent: { ...this.#definition.events[this.#eventIndex]! },
      pointsByRank: [...this.#pointsByRank],
      standings: this.#standings(),
      completedEvents: this.#completedEvents.map(cloneEventResult),
    };
  }

  completeEvent(ranking: readonly string[]): readonly ChampionshipEvent[] {
    if (this.#phase !== "event-ready") {
      throw new Error("Championship event can be completed only from event-ready");
    }
    if (ranking.length !== this.#entrants.length || new Set(ranking).size !== ranking.length) {
      throw new Error("Championship event ranking must contain every entrant exactly once");
    }
    if (ranking.some((id) => !this.#entrants.some((entrant) => entrant.definition.id === id))) {
      throw new Error("Championship event ranking contains an unknown entrant");
    }
    const awardedPoints: Record<string, number> = {};
    ranking.forEach((entrantId, index) => {
      const entrant = this.#entrants.find((candidate) => candidate.definition.id === entrantId)!;
      const points = this.#pointsByRank[index]!;
      entrant.points += points;
      entrant.eventWins += Number(index === 0);
      entrant.cumulativeRank += index + 1;
      entrant.lastEventRank = index + 1;
      awardedPoints[entrantId] = points;
    });
    const event = this.#definition.events[this.#eventIndex]!;
    const result: ChampionshipEventResultSnapshot = {
      eventId: event.id,
      eventName: event.name,
      ranking: [...ranking],
      awardedPoints,
    };
    this.#completedEvents.push(result);
    const events: ChampionshipEvent[] = [{
      type: "championship-event-completed",
      eventId: event.id,
      eventIndex: this.#eventIndex,
      ranking: [...ranking],
      awardedPoints: { ...awardedPoints },
    }];
    if (this.#eventIndex === this.#definition.events.length - 1) {
      this.#phase = "finished";
      const standings = this.#standings();
      events.push({
        type: "championship-completed",
        winnerId: standings[0]!.entrantId,
        standings,
      });
    } else {
      this.#phase = "event-complete";
    }
    return events;
  }

  startNextEvent(): readonly ChampionshipEvent[] {
    if (this.#phase !== "event-complete") {
      throw new Error("Championship can advance only after a non-terminal event");
    }
    this.#eventIndex += 1;
    this.#phase = "event-ready";
    const event = this.#definition.events[this.#eventIndex]!;
    return [{ type: "championship-event-advanced", eventId: event.id, eventIndex: this.#eventIndex }];
  }

  save(): ChampionshipSaveV1 {
    return {
      version: 1,
      championshipId: this.#definition.id,
      phase: this.#phase,
      eventIndex: this.#eventIndex,
      entrants: this.#entrants.map((entrant) => ({
        id: entrant.definition.id,
        points: entrant.points,
        eventWins: entrant.eventWins,
        cumulativeRank: entrant.cumulativeRank,
        lastEventRank: entrant.lastEventRank,
      })),
      completedEvents: this.#completedEvents.map(cloneEventResult),
    };
  }

  #standings(): ChampionshipStandingSnapshot[] {
    const ordered = [...this.#entrants].sort((left, right) => (
      right.points - left.points
      || right.eventWins - left.eventWins
      || left.cumulativeRank - right.cumulativeRank
      || left.initialIndex - right.initialIndex
    ));
    return ordered.map((entrant, index) => ({
      rank: index + 1,
      entrantId: entrant.definition.id,
      displayName: entrant.displayName,
      points: entrant.points,
      eventWins: entrant.eventWins,
      cumulativeRank: entrant.cumulativeRank,
      lastEventRank: entrant.lastEventRank,
      medal: this.#phase !== "finished"
        ? "none"
        : index === 0 ? "gold" : index === 1 ? "silver" : index === 2 ? "bronze" : "none",
    }));
  }

  #restore(save: ChampionshipSaveV1): void {
    if (save.version !== 1 || save.championshipId !== this.#definition.id) {
      throw new Error("Championship save version or definition id does not match");
    }
    if (!Number.isInteger(save.eventIndex) || save.eventIndex < 0 || save.eventIndex >= this.#definition.events.length) {
      throw new Error("Championship save eventIndex is out of range");
    }
    if (save.phase !== "event-ready" && save.phase !== "event-complete" && save.phase !== "finished") {
      throw new Error("Championship save phase is invalid");
    }
    if (save.entrants.length !== this.#entrants.length || save.completedEvents.length > this.#definition.events.length) {
      throw new Error("Championship save shape does not match the definition");
    }
    const expectedCompletedEvents = save.phase === "event-ready" ? save.eventIndex : save.eventIndex + 1;
    if (save.completedEvents.length !== expectedCompletedEvents) {
      throw new Error("Championship save completed-event count is inconsistent with its phase");
    }
    const aggregate = new Map(this.#entrants.map((entrant) => [entrant.definition.id, {
      points: 0,
      eventWins: 0,
      cumulativeRank: 0,
      lastEventRank: null as number | null,
    }]));
    save.completedEvents.forEach((result, eventIndex) => {
      const definition = this.#definition.events[eventIndex];
      if (
        result.eventId !== definition?.id
        || result.eventName !== definition.name
        || result.ranking.length !== this.#entrants.length
        || new Set(result.ranking).size !== this.#entrants.length
        || result.ranking.some((id) => !aggregate.has(id))
      ) {
        throw new Error("Championship save event result does not match the definition");
      }
      const awardedIds = Object.keys(result.awardedPoints);
      if (awardedIds.length !== this.#entrants.length || awardedIds.some((id) => !aggregate.has(id))) {
        throw new Error("Championship save awarded-points shape is invalid");
      }
      result.ranking.forEach((id, rankIndex) => {
        const points = this.#pointsByRank[rankIndex]!;
        if (result.awardedPoints[id] !== points) {
          throw new Error("Championship save awarded points do not match the scoring table");
        }
        const target = aggregate.get(id)!;
        target.points += points;
        target.eventWins += Number(rankIndex === 0);
        target.cumulativeRank += rankIndex + 1;
        target.lastEventRank = rankIndex + 1;
      });
    });
    const savedById = new Map(save.entrants.map((entrant) => [entrant.id, entrant]));
    if (savedById.size !== this.#entrants.length) {
      throw new Error("Championship save entrant ids are duplicated");
    }
    for (const entrant of this.#entrants) {
      const saved = savedById.get(entrant.definition.id);
      const expected = aggregate.get(entrant.definition.id)!;
      if (!saved || [saved.points, saved.eventWins, saved.cumulativeRank].some((value) => (
        !Number.isInteger(value) || value < 0
      )) || (saved.lastEventRank !== null && (
        !Number.isInteger(saved.lastEventRank)
        || saved.lastEventRank < 1
        || saved.lastEventRank > this.#entrants.length
      )) || saved.points !== expected.points
        || saved.eventWins !== expected.eventWins
        || saved.cumulativeRank !== expected.cumulativeRank
        || saved.lastEventRank !== expected.lastEventRank) {
        throw new Error(`Championship save entrant ${entrant.definition.id} is invalid or missing`);
      }
      entrant.points = saved.points;
      entrant.eventWins = saved.eventWins;
      entrant.cumulativeRank = saved.cumulativeRank;
      entrant.lastEventRank = saved.lastEventRank;
    }
    if (
      (save.phase === "finished" && save.eventIndex !== this.#definition.events.length - 1)
      || (save.phase === "event-complete" && save.eventIndex >= this.#definition.events.length - 1)
    ) {
      throw new Error("Championship save phase is inconsistent with its event index");
    }
    this.#phase = save.phase;
    this.#eventIndex = save.eventIndex;
    this.#completedEvents.push(...save.completedEvents.map(cloneEventResult));
  }
}
