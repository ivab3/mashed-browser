import type { TrackVector3 } from "./lap-session.js";
import { LOCAL_PLAYER_SLOTS } from "./local-roster.js";

export type CombatWeaponType = "machine-gun" | "rocket" | "mine";

export interface CombatWeaponConfig {
  ammo: number;
  cooldownSeconds: number;
  damage: number;
  projectileSpeedMetersPerSecond: number;
  projectileLifetimeSeconds: number;
  projectileHitRadiusMeters: number;
  explosionRadiusMeters: number;
  knockbackImpulse: number;
  ownerImmunitySeconds: number;
  armingSeconds: number;
}

export interface CombatPickupDefinition {
  id: string;
  weapon: CombatWeaponType;
  position: TrackVector3;
}

export interface CombatPlayerDefinition {
  id: string;
  displayName?: string;
}

export interface CombatSessionOptions {
  players: readonly CombatPlayerDefinition[];
  pickups: readonly CombatPickupDefinition[];
  maximumHealth?: number;
  pickupRadiusMeters?: number;
  pickupRespawnSeconds?: number;
}

export interface CombatPlayerFrame {
  position: TrackVector3;
  headingRadians: number;
}

export type CombatPlayerFrames = Readonly<Record<string, CombatPlayerFrame | undefined>>;
export type CombatUseRequests = Readonly<Record<string, boolean | undefined>>;

export interface CombatInventorySnapshot {
  weapon: CombatWeaponType;
  ammo: number;
}

export interface CombatPlayerSnapshot {
  id: string;
  displayName: string;
  health: number;
  maximumHealth: number;
  destroyed: boolean;
  inventory: CombatInventorySnapshot | null;
}

export interface CombatPickupSnapshot extends CombatPickupDefinition {
  active: boolean;
  respawnSecondsRemaining: number;
}

export interface CombatProjectileSnapshot {
  id: number;
  weapon: CombatWeaponType;
  ownerId: string;
  position: TrackVector3;
  previousPosition: TrackVector3;
  velocity: TrackVector3;
  ageSeconds: number;
}

export interface CombatSnapshot {
  elapsedSeconds: number;
  players: readonly CombatPlayerSnapshot[];
  pickups: readonly CombatPickupSnapshot[];
  projectiles: readonly CombatProjectileSnapshot[];
}

export type CombatEvent =
  | { type: "pickup-collected"; pickupId: string; playerId: string; weapon: CombatWeaponType; ammo: number }
  | { type: "pickup-respawned"; pickupId: string }
  | { type: "weapon-fired"; playerId: string; weapon: CombatWeaponType; projectileId: number; ammoRemaining: number }
  | {
      type: "player-damaged";
      playerId: string;
      sourcePlayerId: string;
      weapon: CombatWeaponType;
      damage: number;
      healthRemaining: number;
      knockbackImpulse: TrackVector3;
    }
  | { type: "player-destroyed"; playerId: string; sourcePlayerId: string; weapon: CombatWeaponType }
  | { type: "projectile-expired"; projectileId: number };

export const COMBAT_WEAPON_CONFIGS: Readonly<Record<CombatWeaponType, Readonly<CombatWeaponConfig>>> = Object.freeze({
  "machine-gun": Object.freeze({
    ammo: 12,
    cooldownSeconds: 0.12,
    damage: 10,
    projectileSpeedMetersPerSecond: 48,
    projectileLifetimeSeconds: 1.2,
    projectileHitRadiusMeters: 0.85,
    explosionRadiusMeters: 0,
    knockbackImpulse: 2_400,
    ownerImmunitySeconds: 0.12,
    armingSeconds: 0,
  }),
  rocket: Object.freeze({
    ammo: 3,
    cooldownSeconds: 0.65,
    damage: 38,
    projectileSpeedMetersPerSecond: 24,
    projectileLifetimeSeconds: 3,
    projectileHitRadiusMeters: 1.25,
    explosionRadiusMeters: 4,
    knockbackImpulse: 11_000,
    ownerImmunitySeconds: 0.3,
    armingSeconds: 0,
  }),
  mine: Object.freeze({
    ammo: 2,
    cooldownSeconds: 0.5,
    damage: 52,
    projectileSpeedMetersPerSecond: 0,
    projectileLifetimeSeconds: 16,
    projectileHitRadiusMeters: 2.2,
    explosionRadiusMeters: 3.5,
    knockbackImpulse: 14_000,
    ownerImmunitySeconds: 1,
    armingSeconds: 0.55,
  }),
});

interface CombatPlayerRuntime {
  readonly definition: CombatPlayerDefinition;
  readonly displayName: string;
  health: number;
  destroyed: boolean;
  inventory: CombatInventorySnapshot | undefined;
  cooldownSecondsRemaining: number;
}

interface CombatPickupRuntime {
  readonly definition: CombatPickupDefinition;
  active: boolean;
  respawnSecondsRemaining: number;
}

interface CombatProjectileRuntime extends CombatProjectileSnapshot {
  previousPosition: TrackVector3;
}

const MAX_LOCAL_PLAYERS = LOCAL_PLAYER_SLOTS.length;

function squaredDistance(left: TrackVector3, right: TrackVector3): number {
  const x = left[0] - right[0];
  const y = left[1] - right[1];
  const z = left[2] - right[2];
  return x * x + y * y + z * z;
}

function pointToSegmentSquaredDistance(
  point: TrackVector3,
  start: TrackVector3,
  finish: TrackVector3,
): number {
  const dx = finish[0] - start[0];
  const dy = finish[1] - start[1];
  const dz = finish[2] - start[2];
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared <= Number.EPSILON) {
    return squaredDistance(point, start);
  }
  const progress = Math.max(0, Math.min(1, (
    (point[0] - start[0]) * dx
    + (point[1] - start[1]) * dy
    + (point[2] - start[2]) * dz
  ) / lengthSquared));
  return squaredDistance(point, [
    start[0] + dx * progress,
    start[1] + dy * progress,
    start[2] + dz * progress,
  ]);
}

function validateVector(vector: TrackVector3, name: string): void {
  if (vector.some((component) => !Number.isFinite(component))) {
    throw new Error(`${name} must have finite coordinates`);
  }
}

function normalizedKnockback(
  source: TrackVector3,
  target: TrackVector3,
  fallbackVelocity: TrackVector3,
  magnitude: number,
): TrackVector3 {
  let x = target[0] - source[0];
  let z = target[2] - source[2];
  let length = Math.hypot(x, z);
  if (length < 1e-6) {
    x = fallbackVelocity[0];
    z = fallbackVelocity[2];
    length = Math.hypot(x, z);
  }
  if (length < 1e-6) {
    x = 0;
    z = 1;
    length = 1;
  }
  return [x / length * magnitude, magnitude * 0.16, z / length * magnitude];
}

/** Pure fixed-step pickup, projectile, damage, and destruction rules for one local match. */
export class CombatSession {
  readonly #players: CombatPlayerRuntime[];
  readonly #pickups: CombatPickupRuntime[];
  readonly #maximumHealth: number;
  readonly #pickupRadiusMeters: number;
  readonly #pickupRespawnSeconds: number;
  readonly #projectiles: CombatProjectileRuntime[] = [];
  #elapsedSeconds = 0;
  #nextProjectileId = 1;

  constructor(options: CombatSessionOptions) {
    if (options.players.length < 1 || options.players.length > MAX_LOCAL_PLAYERS) {
      throw new Error(`Combat needs between 1 and ${MAX_LOCAL_PLAYERS} players`);
    }
    this.#maximumHealth = options.maximumHealth ?? 100;
    this.#pickupRadiusMeters = options.pickupRadiusMeters ?? 2.1;
    this.#pickupRespawnSeconds = options.pickupRespawnSeconds ?? 8;
    if (
      !Number.isFinite(this.#maximumHealth) || this.#maximumHealth <= 0
      || !Number.isFinite(this.#pickupRadiusMeters) || this.#pickupRadiusMeters <= 0
      || !Number.isFinite(this.#pickupRespawnSeconds) || this.#pickupRespawnSeconds < 0
    ) {
      throw new Error("Combat health/radius must be positive and respawn time non-negative");
    }

    const playerIds = new Set<string>();
    this.#players = options.players.map((definition) => {
      if (definition.id.length === 0 || playerIds.has(definition.id)) {
        throw new Error(`Combat player id ${JSON.stringify(definition.id)} is empty or duplicated`);
      }
      playerIds.add(definition.id);
      return {
        definition,
        displayName: definition.displayName ?? definition.id,
        health: this.#maximumHealth,
        destroyed: false,
        inventory: undefined,
        cooldownSecondsRemaining: 0,
      };
    });
    const pickupIds = new Set<string>();
    this.#pickups = options.pickups.map((definition) => {
      if (definition.id.length === 0 || pickupIds.has(definition.id)) {
        throw new Error(`Combat pickup id ${JSON.stringify(definition.id)} is empty or duplicated`);
      }
      pickupIds.add(definition.id);
      validateVector(definition.position, `Combat pickup ${definition.id}`);
      return { definition, active: true, respawnSecondsRemaining: 0 };
    });
  }

  get snapshot(): CombatSnapshot {
    return {
      elapsedSeconds: this.#elapsedSeconds,
      players: this.#players.map((player) => ({
        id: player.definition.id,
        displayName: player.displayName,
        health: player.health,
        maximumHealth: this.#maximumHealth,
        destroyed: player.destroyed,
        inventory: player.inventory ? { ...player.inventory } : null,
      })),
      pickups: this.#pickups.map((pickup) => ({
        ...pickup.definition,
        position: [...pickup.definition.position],
        active: pickup.active,
        respawnSecondsRemaining: pickup.respawnSecondsRemaining,
      })),
      projectiles: this.#projectiles.map((projectile) => ({
        id: projectile.id,
        weapon: projectile.weapon,
        ownerId: projectile.ownerId,
        position: [...projectile.position],
        previousPosition: [...projectile.previousPosition],
        velocity: [...projectile.velocity],
        ageSeconds: projectile.ageSeconds,
      })),
    };
  }

  advance(
    stepSeconds: number,
    playerFrames: CombatPlayerFrames,
    useRequests: CombatUseRequests = {},
  ): readonly CombatEvent[] {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new Error("Combat stepSeconds must be a finite positive number");
    }
    for (const [id, frame] of Object.entries(playerFrames)) {
      if (!this.#players.some((player) => player.definition.id === id)) {
        throw new Error(`Unknown combat player frame ${id}`);
      }
      if (frame) {
        validateVector(frame.position, `Combat player ${id}`);
        if (!Number.isFinite(frame.headingRadians)) {
          throw new Error(`Combat player ${id} must have a finite heading`);
        }
      }
    }

    this.#elapsedSeconds += stepSeconds;
    const events: CombatEvent[] = [];
    for (const player of this.#players) {
      player.cooldownSecondsRemaining = Math.max(0, player.cooldownSecondsRemaining - stepSeconds);
    }
    this.#advancePickups(stepSeconds, playerFrames, events);
    this.#fireWeapons(playerFrames, useRequests, events);
    this.#advanceProjectiles(stepSeconds, playerFrames, events);
    return events;
  }

  #advancePickups(
    stepSeconds: number,
    playerFrames: CombatPlayerFrames,
    events: CombatEvent[],
  ): void {
    for (const pickup of this.#pickups) {
      if (!pickup.active) {
        pickup.respawnSecondsRemaining = Math.max(0, pickup.respawnSecondsRemaining - stepSeconds);
        if (pickup.respawnSecondsRemaining === 0) {
          pickup.active = true;
          events.push({ type: "pickup-respawned", pickupId: pickup.definition.id });
        }
      }
      if (!pickup.active) {
        continue;
      }
      const collector = this.#players.find((player) => {
        const frame = playerFrames[player.definition.id];
        return !player.destroyed
          && !player.inventory
          && frame !== undefined
          && squaredDistance(frame.position, pickup.definition.position)
            <= this.#pickupRadiusMeters * this.#pickupRadiusMeters;
      });
      if (!collector) {
        continue;
      }
      const config = COMBAT_WEAPON_CONFIGS[pickup.definition.weapon];
      collector.inventory = { weapon: pickup.definition.weapon, ammo: config.ammo };
      pickup.active = false;
      pickup.respawnSecondsRemaining = this.#pickupRespawnSeconds;
      events.push({
        type: "pickup-collected",
        pickupId: pickup.definition.id,
        playerId: collector.definition.id,
        weapon: pickup.definition.weapon,
        ammo: config.ammo,
      });
    }
  }

  #fireWeapons(
    playerFrames: CombatPlayerFrames,
    useRequests: CombatUseRequests,
    events: CombatEvent[],
  ): void {
    for (const player of this.#players) {
      const frame = playerFrames[player.definition.id];
      const inventory = player.inventory;
      if (
        player.destroyed || !frame || !inventory || !useRequests[player.definition.id]
        || player.cooldownSecondsRemaining > 0
      ) {
        continue;
      }
      const config = COMBAT_WEAPON_CONFIGS[inventory.weapon];
      const forward: TrackVector3 = [Math.sin(frame.headingRadians), 0, Math.cos(frame.headingRadians)];
      const mine = inventory.weapon === "mine";
      const offset = mine ? -1.9 : 1.8;
      const position: TrackVector3 = [
        frame.position[0] + forward[0] * offset,
        frame.position[1] + (mine ? 0.1 : 0.45),
        frame.position[2] + forward[2] * offset,
      ];
      const velocity: TrackVector3 = mine
        ? [0, 0, 0]
        : [
            forward[0] * config.projectileSpeedMetersPerSecond,
            0,
            forward[2] * config.projectileSpeedMetersPerSecond,
          ];
      const projectileId = this.#nextProjectileId;
      this.#nextProjectileId += 1;
      this.#projectiles.push({
        id: projectileId,
        weapon: inventory.weapon,
        ownerId: player.definition.id,
        position,
        previousPosition: position,
        velocity,
        ageSeconds: 0,
      });
      inventory.ammo -= 1;
      const ammoRemaining = inventory.ammo;
      const weapon = inventory.weapon;
      if (inventory.ammo === 0) {
        player.inventory = undefined;
      }
      player.cooldownSecondsRemaining = config.cooldownSeconds;
      events.push({
        type: "weapon-fired",
        playerId: player.definition.id,
        weapon,
        projectileId,
        ammoRemaining,
      });
    }
  }

  #advanceProjectiles(
    stepSeconds: number,
    playerFrames: CombatPlayerFrames,
    events: CombatEvent[],
  ): void {
    const removed = new Set<number>();
    for (const projectile of this.#projectiles) {
      const config = COMBAT_WEAPON_CONFIGS[projectile.weapon];
      projectile.ageSeconds += stepSeconds;
      projectile.previousPosition = projectile.position;
      projectile.position = [
        projectile.position[0] + projectile.velocity[0] * stepSeconds,
        projectile.position[1] + projectile.velocity[1] * stepSeconds,
        projectile.position[2] + projectile.velocity[2] * stepSeconds,
      ];
      if (projectile.ageSeconds >= config.projectileLifetimeSeconds) {
        removed.add(projectile.id);
        events.push({ type: "projectile-expired", projectileId: projectile.id });
        continue;
      }
      if (projectile.ageSeconds < config.armingSeconds) {
        continue;
      }
      const directTarget = this.#players.find((player) => {
        const frame = playerFrames[player.definition.id];
        return !player.destroyed
          && frame !== undefined
          && (player.definition.id !== projectile.ownerId
            || projectile.ageSeconds >= config.ownerImmunitySeconds)
          && pointToSegmentSquaredDistance(
            frame.position,
            projectile.previousPosition,
            projectile.position,
          ) <= config.projectileHitRadiusMeters * config.projectileHitRadiusMeters;
      });
      if (!directTarget) {
        continue;
      }
      removed.add(projectile.id);
      const affected = config.explosionRadiusMeters > 0
        ? this.#players.filter((player) => {
            const frame = playerFrames[player.definition.id];
            return !player.destroyed
              && frame !== undefined
              && (player.definition.id !== projectile.ownerId
                || projectile.ageSeconds >= config.ownerImmunitySeconds)
              && squaredDistance(frame.position, projectile.position)
              <= config.explosionRadiusMeters * config.explosionRadiusMeters;
          })
        : [directTarget];
      for (const target of affected) {
        const frame = playerFrames[target.definition.id]!;
        const damage = Math.min(target.health, config.damage);
        target.health -= damage;
        const knockbackImpulse = normalizedKnockback(
          projectile.position,
          frame.position,
          projectile.velocity,
          config.knockbackImpulse,
        );
        events.push({
          type: "player-damaged",
          playerId: target.definition.id,
          sourcePlayerId: projectile.ownerId,
          weapon: projectile.weapon,
          damage,
          healthRemaining: target.health,
          knockbackImpulse,
        });
        if (target.health === 0) {
          target.destroyed = true;
          target.inventory = undefined;
          events.push({
            type: "player-destroyed",
            playerId: target.definition.id,
            sourcePlayerId: projectile.ownerId,
            weapon: projectile.weapon,
          });
        }
      }
    }
    for (let index = this.#projectiles.length - 1; index >= 0; index -= 1) {
      if (removed.has(this.#projectiles[index]!.id)) {
        this.#projectiles.splice(index, 1);
      }
    }
  }
}
