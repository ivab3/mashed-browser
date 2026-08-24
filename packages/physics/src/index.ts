import {
  cloneTransform,
  type RuntimeEventBus,
  type SimulationTransform,
} from "@mashed/core";
import {
  NEUTRAL_VEHICLE_INPUT,
  sanitizeVehicleInput,
  type VehicleInputFrame,
} from "@mashed/input";

export {
  DEFAULT_VEHICLE_CONFIG,
  type SourceVehicleStats,
  type SteeringSpeedCurve,
  type SurfaceHandlingConfig,
  type SurfaceType,
  type VehicleConfig,
} from "./vehicle-config.js";
export {
  deriveRouteCollisionLayers,
  type RouteCollisionLayers,
  type RouteCollisionSector,
} from "./route-collision.js";
import type { RouteCollisionLayers } from "./route-collision.js";
import {
  DEFAULT_VEHICLE_CONFIG,
  type SourceVehicleStats,
  type SteeringSpeedCurve,
  type SurfaceType,
  type VehicleConfig,
} from "./vehicle-config.js";

type RapierModule = typeof import("@dimforge/rapier3d-compat");
type RapierWorld = import("@dimforge/rapier3d-compat").World;
type RapierRigidBody = import("@dimforge/rapier3d-compat").RigidBody;
type RapierEventQueue = import("@dimforge/rapier3d-compat").EventQueue;
type RapierVehicleController = import("@dimforge/rapier3d-compat").DynamicRayCastVehicleController;
type RapierVector = import("@dimforge/rapier3d-compat").Vector;
type RapierRotation = import("@dimforge/rapier3d-compat").Rotation;

export interface PhysicsTransformHistory {
  previous: SimulationTransform;
  current: SimulationTransform;
}

export interface PhysicsMetrics {
  bodies: number;
  colliders: number;
  contacts: number;
  activeObjects: number;
  destroyedObjects: number;
  trackTriangles: number;
}

export interface PhysicsDebugLines {
  vertices: Float32Array;
  colors: Float32Array;
}

export interface VehicleTelemetry {
  speedMetersPerSecond: number;
  forwardSpeedMetersPerSecond: number;
  lateralSpeedMetersPerSecond: number;
  headingRadians: number;
  groundedWheels: number;
  steeringRadians: number;
  surface: SurfaceType | "airborne";
}

export const PRIMARY_VEHICLE_ID = "vehicle-one";
export type VehicleInputById = Readonly<Record<string, VehicleInputFrame>>;

export type PhysicsSceneObjectKind = "crate" | "barrel" | "block" | "vehicle";

export interface PhysicsSceneObject {
  id: string;
  kind: PhysicsSceneObjectKind;
  destructible: boolean;
  active: boolean;
  history: PhysicsTransformHistory;
}

export interface StaticCollisionSector {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface VehicleSpawn {
  position: readonly [number, number, number];
  headingRadians: number;
}

export interface PhysicsRuntimeOptions {
  collisionObjects?: boolean;
  collisionVehicle?: {
    id: string;
    spawn: VehicleSpawn;
  };
}

interface SurfaceBodyData {
  surface: SurfaceType;
  wheelSurface?: boolean;
}

interface ArenaObject {
  id: string;
  kind: PhysicsSceneObjectKind;
  destructible: boolean;
  active: boolean;
  breakForce: number;
  colliderHandle: number;
  body: RapierRigidBody;
  initialPosition: readonly [number, number, number];
  initialRotation: readonly [number, number, number, number];
  history: PhysicsTransformHistory;
}

interface ArenaObjectSpec {
  id: string;
  kind: PhysicsSceneObjectKind;
  position: readonly [number, number, number];
  halfExtents: readonly [number, number, number];
  mass: number;
  destructible: boolean;
  breakForce: number;
}

interface VehicleControlState {
  steeringRadians: number;
  forwardDriveSeconds: number;
  reverseDriveSeconds: number;
  upsideDownSeconds: number;
  recoveryWasPressed: boolean;
  telemetry: VehicleTelemetry;
}

interface CollisionVehicleRuntime {
  id: string;
  spawn: VehicleSpawn;
  body: RapierRigidBody;
  controller: RapierVehicleController;
  object: ArenaObject;
  control: VehicleControlState;
}

const SURFACE_ORDER: readonly SurfaceType[] = ["ice", "asphalt", "sand", "mud"];
const FRONT_WHEELS = new Set([0, 1]);
const REAR_WHEELS = new Set([2, 3]);
const ARENA_OBJECT_SPECS: readonly ArenaObjectSpec[] = [
  {
    id: "crate-a",
    kind: "crate",
    position: [-4, 0.55, 7],
    halfExtents: [0.55, 0.55, 0.55],
    mass: 48,
    destructible: true,
    breakForce: 8_500,
  },
  {
    id: "crate-b",
    kind: "crate",
    position: [-3.2, 0.55, 12],
    halfExtents: [0.55, 0.55, 0.55],
    mass: 55,
    destructible: true,
    breakForce: 10_000,
  },
  {
    id: "barrel-a",
    kind: "barrel",
    position: [-4.4, 0.55, 16],
    halfExtents: [0.42, 0.55, 0.42],
    mass: 32,
    destructible: true,
    breakForce: 7_000,
  },
  {
    id: "block-heavy",
    kind: "block",
    position: [-4, 0.75, 23],
    halfExtents: [0.8, 0.75, 0.8],
    mass: 260,
    destructible: false,
    breakForce: Number.POSITIVE_INFINITY,
  },
];

function transformOf(body: RapierRigidBody): SimulationTransform {
  const position = body.translation();
  const rotation = body.rotation();
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
  };
}

function createVehicleControlState(): VehicleControlState {
  return {
    steeringRadians: 0,
    forwardDriveSeconds: 0,
    reverseDriveSeconds: 0,
    upsideDownSeconds: 0,
    recoveryWasPressed: false,
    telemetry: {
      speedMetersPerSecond: 0,
      forwardSpeedMetersPerSecond: 0,
      lateralSpeedMetersPerSecond: 0,
      headingRadians: 0,
      groundedWheels: 0,
      steeringRadians: 0,
      surface: "airborne",
    },
  };
}

function contactKey(handleA: number, handleB: number): string {
  return handleA < handleB ? `${handleA}:${handleB}` : `${handleB}:${handleA}`;
}

function approach(current: number, target: number, maximumDelta: number): number {
  if (current < target) {
    return Math.min(target, current + maximumDelta);
  }
  return Math.max(target, current - maximumDelta);
}

/** Normalized drive-force envelope; the default 0.5/6 curve is sourced from MFL.exe. */
export function driveForceBuildUpFactor(
  heldSeconds: number,
  initialFactor: number,
  rampSeconds: number,
): number {
  const start = Math.min(1, Math.max(0, initialFactor));
  if (rampSeconds <= 0) {
    return 1;
  }
  const progress = Math.min(1, Math.max(0, heldSeconds) / rampSeconds);
  return start + (1 - start) * progress;
}

/** Speed-sensitive steering curve; reciprocal mode maps MFL's 10 + 0.01 * speed relationship. */
export function steeringSpeedScale(
  speedMetersPerSecond: number,
  maximumSpeedMetersPerSecond: number,
  curve: SteeringSpeedCurve,
  attenuation: number,
): number {
  const speedRatio = maximumSpeedMetersPerSecond <= 0
    ? 0
    : Math.min(1, Math.abs(speedMetersPerSecond) / maximumSpeedMetersPerSecond);
  const strength = Math.max(0, attenuation);
  return curve === "reciprocal"
    ? 1 / (1 + strength * speedRatio)
    : Math.max(0, 1 - strength * speedRatio);
}

const CRUSADER_SOURCE_GRIP = 35_000;
const CRUSADER_SOURCE_HANDLING = 0.9;

/** Relative source-stat adapter anchored to the accepted Crusader tune. */
export function sourceHandlingScales(
  stats: Pick<SourceVehicleStats, "grip" | "handling">,
): { grip: number; handling: number } {
  const grip = Number.isFinite(stats.grip) && stats.grip > 0
    ? stats.grip / CRUSADER_SOURCE_GRIP
    : 1;
  const handling = Number.isFinite(stats.handling) && stats.handling > 0
    ? CRUSADER_SOURCE_HANDLING / stats.handling
    : 1;
  return { grip, handling };
}

function rotateVector(vector: RapierVector, rotation: RapierRotation): RapierVector {
  const temporaryX = 2 * (rotation.y * vector.z - rotation.z * vector.y);
  const temporaryY = 2 * (rotation.z * vector.x - rotation.x * vector.z);
  const temporaryZ = 2 * (rotation.x * vector.y - rotation.y * vector.x);
  return {
    x: vector.x + rotation.w * temporaryX + rotation.y * temporaryZ - rotation.z * temporaryY,
    y: vector.y + rotation.w * temporaryY + rotation.z * temporaryX - rotation.x * temporaryZ,
    z: vector.z + rotation.w * temporaryZ + rotation.x * temporaryY - rotation.y * temporaryX,
  };
}

function yawRotation(headingRadians: number): RapierRotation {
  return {
    x: 0,
    y: Math.sin(headingRadians / 2),
    z: 0,
    w: Math.cos(headingRadians / 2),
  };
}

function headingOf(rotation: RapierRotation): number {
  return Math.atan2(
    2 * (rotation.w * rotation.y + rotation.x * rotation.z),
    1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z),
  );
}

function isSurfaceBodyData(value: unknown): value is SurfaceBodyData {
  if (!value || typeof value !== "object" || !("surface" in value)) {
    return false;
  }
  return SURFACE_ORDER.includes((value as SurfaceBodyData).surface);
}

function cuboidInertia(mass: number, halfExtents: readonly [number, number, number]): RapierVector {
  const [halfX, halfY, halfZ] = halfExtents;
  return {
    x: (mass / 3) * (halfY * halfY + halfZ * halfZ),
    y: (mass / 3) * (halfX * halfX + halfZ * halfZ),
    z: (mass / 3) * (halfX * halfX + halfY * halfY),
  };
}

/** Fixed-step, data-driven arcade vehicle runtime. */
export class PhysicsRuntime {
  readonly #RAPIER: RapierModule;
  readonly #events: RuntimeEventBus;
  readonly #world: RapierWorld;
  readonly #eventQueue: RapierEventQueue;
  readonly #body: RapierRigidBody;
  readonly #vehicle: RapierVehicleController;
  readonly #config: VehicleConfig;
  readonly #sourceHandling: { grip: number; handling: number };
  readonly #contacts = new Set<string>();
  readonly #arenaBodies: RapierRigidBody[] = [];
  readonly #arenaObjects: ArenaObject[] = [];
  readonly #collisionVehicles: CollisionVehicleRuntime[] = [];
  readonly #objectByCollider = new Map<number, ArenaObject>();
  readonly #trackBodies: RapierRigidBody[] = [];
  #trackTriangles = 0;
  #activeSpawn: VehicleSpawn;
  #history: PhysicsTransformHistory;
  readonly #control = createVehicleControlState();

  constructor(
    RAPIER: RapierModule,
    events: RuntimeEventBus,
    stepSeconds: number,
    config: VehicleConfig = DEFAULT_VEHICLE_CONFIG,
    options: PhysicsRuntimeOptions = {},
  ) {
    this.#RAPIER = RAPIER;
    this.#events = events;
    this.#config = structuredClone(config);
    this.#sourceHandling = sourceHandlingScales(this.#config.sourceStats);
    this.#activeSpawn = {
      position: [...this.#config.spawn.position],
      headingRadians: this.#config.spawn.headingRadians,
    };
    this.#world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.#world.timestep = stepSeconds;
    this.#eventQueue = new RAPIER.EventQueue(true);
    this.#createArena(RAPIER);

    const { spawn } = this.#config;
    this.#body = this.#createChassisBody(spawn).body;

    this.#vehicle = this.#createVehicleController(this.#body);
    if (options.collisionObjects !== false) {
      this.#createCollisionObjects();
    }
    if (options.collisionVehicle) {
      this.#createCollisionVehicle(options.collisionVehicle.id, options.collisionVehicle.spawn);
    }
    const initial = transformOf(this.#body);
    this.#history = { previous: cloneTransform(initial), current: initial };
  }

  #createVehicleController(body: RapierRigidBody): RapierVehicleController {
    const vehicle = this.#world.createVehicleController(body);
    vehicle.indexUpAxis = 1;
    vehicle.setIndexForwardAxis = 2;
    for (const connection of this.#config.wheels.connectionPoints) {
      vehicle.addWheel(
        { x: connection[0], y: connection[1], z: connection[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        this.#config.wheels.suspensionRestLength,
        this.#config.wheels.radius,
      );
    }
    for (let wheel = 0; wheel < vehicle.numWheels(); wheel += 1) {
      vehicle.setWheelMaxSuspensionTravel(wheel, this.#config.wheels.maxSuspensionTravel);
      vehicle.setWheelSuspensionStiffness(wheel, this.#config.wheels.suspensionStiffness);
      vehicle.setWheelSuspensionCompression(wheel, this.#config.wheels.suspensionCompression);
      vehicle.setWheelSuspensionRelaxation(wheel, this.#config.wheels.suspensionRelaxation);
      vehicle.setWheelMaxSuspensionForce(wheel, this.#config.wheels.maxSuspensionForce);
      vehicle.setWheelFrictionSlip(
        wheel,
        this.#config.handling.baseFrictionSlip * this.#sourceHandling.grip,
      );
      vehicle.setWheelSideFrictionStiffness(
        wheel,
        this.#config.handling.baseSideFriction * this.#sourceHandling.handling,
      );
    }
    return vehicle;
  }

  #createChassisBody(spawn: VehicleSpawn): { body: RapierRigidBody; colliderHandle: number } {
    const RAPIER = this.#RAPIER;
    const chassis = this.#config.chassis;
    const rotation = yawRotation(spawn.headingRadians);
    const body = this.#world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...spawn.position)
        .setRotation(rotation)
        .setUserData({ wheelSurface: false })
        .setLinearDamping(chassis.linearDamping)
        .setAngularDamping(chassis.angularDamping)
        .setAdditionalMassProperties(
          chassis.mass,
          { x: chassis.centerOfMass[0], y: chassis.centerOfMass[1], z: chassis.centerOfMass[2] },
          cuboidInertia(chassis.mass, chassis.halfExtents),
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setCcdEnabled(true)
        .setCanSleep(true),
    );
    const collisionEvents = RAPIER.ActiveEvents.COLLISION_EVENTS;
    const collider = this.#world.createCollider(
      RAPIER.ColliderDesc.cuboid(...chassis.halfExtents)
        .setMass(0)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(this.#config.collisionResponse.chassisRestitution)
        .setActiveEvents(collisionEvents),
      body,
    );
    this.#world.createCollider(
      RAPIER.ColliderDesc.cuboid(...chassis.noseHalfExtents)
        .setTranslation(...chassis.noseOffset)
        .setMass(0)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(this.#config.collisionResponse.noseRestitution)
        .setActiveEvents(collisionEvents),
      body,
    );
    return { body, colliderHandle: collider.handle };
  }

  get transformHistory(): PhysicsTransformHistory {
    return this.#history;
  }

  get telemetry(): VehicleTelemetry {
    return { ...this.#control.telemetry };
  }

  getVehicleTelemetry(id: string): VehicleTelemetry | undefined {
    if (id === PRIMARY_VEHICLE_ID) {
      return this.telemetry;
    }
    const vehicle = this.#collisionVehicles.find((candidate) => candidate.id === id);
    return vehicle ? { ...vehicle.control.telemetry } : undefined;
  }

  get sceneObjects(): readonly PhysicsSceneObject[] {
    return this.#arenaObjects.map((object) => ({
      id: object.id,
      kind: object.kind,
      destructible: object.destructible,
      active: object.active,
      history: {
        previous: cloneTransform(object.history.previous),
        current: cloneTransform(object.history.current),
      },
    }));
  }

  get metrics(): PhysicsMetrics {
    return {
      bodies: this.#world.bodies.len(),
      colliders: this.#world.colliders.len(),
      contacts: this.#contacts.size,
      activeObjects: this.#arenaObjects.filter((object) => object.active).length,
      destroyedObjects: this.#arenaObjects.filter((object) => !object.active).length,
      trackTriangles: this.#trackTriangles,
    };
  }

  setTrackCollision(source: readonly StaticCollisionSector[] | RouteCollisionLayers): number {
    const layers = (Array.isArray(source)
      ? { drive: source, scenery: [] }
      : source) as RouteCollisionLayers;
    const sectors = [...layers.drive, ...layers.scenery];
    const validSectors = sectors.filter((sector, index) => {
      if (sector.positions.length % 3 !== 0) {
        throw new Error(`Track collision sector ${index} has an invalid position array`);
      }
      if (sector.indices.length % 3 !== 0) {
        throw new Error(`Track collision sector ${index} has an invalid index array`);
      }
      const vertexCount = sector.positions.length / 3;
      for (const vertexIndex of sector.indices) {
        if (vertexIndex >= vertexCount) {
          throw new Error(`Track collision sector ${index} references vertex ${vertexIndex}/${vertexCount}`);
        }
      }
      return sector.indices.length > 0;
    });
    this.clearTrackCollision();
    if (validSectors.length === 0) {
      return 0;
    }
    this.#setArenaEnabled(false);

    const createLayer = (layerSectors: readonly StaticCollisionSector[], wheelSurface: boolean): void => {
      const filtered = validSectors.filter((sector) => layerSectors.includes(sector));
      if (filtered.length === 0) {
        return;
      }
      const body = this.#world.createRigidBody(
        this.#RAPIER.RigidBodyDesc.fixed().setUserData({
          surface: "asphalt",
          wheelSurface,
        } satisfies SurfaceBodyData),
      );
      this.#trackBodies.push(body);
      const positions = new Float32Array(filtered.reduce((total, sector) => total + sector.positions.length, 0));
      const indices = new Uint32Array(filtered.reduce((total, sector) => total + sector.indices.length, 0));
      let positionOffset = 0;
      let indexOffset = 0;
      let vertexOffset = 0;
      for (const sector of filtered) {
        positions.set(sector.positions, positionOffset);
        for (const index of sector.indices) {
          indices[indexOffset] = index + vertexOffset;
          indexOffset += 1;
        }
        positionOffset += sector.positions.length;
        vertexOffset += sector.positions.length / 3;
      }
      this.#world.createCollider(
        this.#RAPIER.ColliderDesc.trimesh(
          positions,
          indices,
          this.#RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES,
        )
          .setFriction(0.9)
          .setRestitution(this.#config.collisionResponse.trackRestitution)
          .setActiveEvents(this.#RAPIER.ActiveEvents.COLLISION_EVENTS),
        body,
      );
    };
    createLayer(layers.drive, true);
    createLayer(layers.scenery, false);
    this.#trackTriangles = validSectors.reduce((total, sector) => total + sector.indices.length / 3, 0);
    return this.#trackTriangles;
  }

  clearTrackCollision(): void {
    for (const body of this.#trackBodies) {
      this.#world.removeRigidBody(body);
    }
    this.#trackBodies.length = 0;
    this.#trackTriangles = 0;
    this.#setArenaEnabled(true);
  }

  setRaceSpawn(spawn: VehicleSpawn): void {
    if (
      spawn.position.some((component) => !Number.isFinite(component))
      || !Number.isFinite(spawn.headingRadians)
    ) {
      throw new Error("Vehicle spawn must contain finite coordinates and heading");
    }
    this.#activeSpawn = {
      position: [...spawn.position],
      headingRadians: spawn.headingRadians,
    };
    this.resetDemo();
  }

  step(
    stepSeconds: number,
    rawInput: VehicleInputFrame = NEUTRAL_VEHICLE_INPUT,
    rawVehicleInputs: VehicleInputById = {},
  ): void {
    if (Math.abs(this.#world.timestep - stepSeconds) > 1e-7) {
      throw new Error(`Physics timestep changed from ${this.#world.timestep} to ${stepSeconds}`);
    }
    const input = sanitizeVehicleInput(rawInput);
    const requestedRecovery = input.recover && !this.#control.recoveryWasPressed;
    this.#control.recoveryWasPressed = input.recover;
    if (requestedRecovery) {
      this.recover();
    }
    const collisionInputs = new Map<CollisionVehicleRuntime, VehicleInputFrame>();
    for (const collisionVehicle of this.#collisionVehicles) {
      const vehicleInput = sanitizeVehicleInput(
        rawVehicleInputs[collisionVehicle.id] ?? NEUTRAL_VEHICLE_INPUT,
      );
      const recover = vehicleInput.recover && !collisionVehicle.control.recoveryWasPressed;
      collisionVehicle.control.recoveryWasPressed = vehicleInput.recover;
      if (recover) {
        this.#recoverCollisionVehicle(collisionVehicle);
      }
      collisionInputs.set(collisionVehicle, vehicleInput);
    }

    this.#history = {
      previous: cloneTransform(this.#history.current),
      current: this.#history.current,
    };
    for (const object of this.#arenaObjects) {
      object.history = {
        previous: cloneTransform(object.history.current),
        current: object.history.current,
      };
    }
    this.#body.resetForces(true);
    this.#body.resetTorques(true);
    this.#applyVehicleControls(this.#body, this.#vehicle, this.#control, input, stepSeconds);
    this.#vehicle.updateVehicle(stepSeconds, undefined, undefined, (collider) => (
      collider.parent()?.handle !== this.#body.handle
      && (collider.parent()?.userData as SurfaceBodyData | undefined)?.wheelSurface !== false
    ));
    this.#applyStability();
    for (const collisionVehicle of this.#collisionVehicles) {
      collisionVehicle.body.resetForces(true);
      collisionVehicle.body.resetTorques(true);
      this.#applyVehicleControls(
        collisionVehicle.body,
        collisionVehicle.controller,
        collisionVehicle.control,
        collisionInputs.get(collisionVehicle) ?? NEUTRAL_VEHICLE_INPUT,
        stepSeconds,
      );
      collisionVehicle.controller.updateVehicle(stepSeconds, undefined, undefined, (collider) => (
        collider.parent()?.handle !== collisionVehicle.body.handle
        && (collider.parent()?.userData as SurfaceBodyData | undefined)?.wheelSurface !== false
      ));
      this.#applyStability(collisionVehicle.body, collisionVehicle.controller);
    }
    this.#world.step(this.#eventQueue);
    this.#drainEvents();
    this.#history = {
      previous: this.#history.previous,
      current: transformOf(this.#body),
    };
    for (const object of this.#arenaObjects) {
      if (object.active) {
        object.history = {
          previous: object.history.previous,
          current: transformOf(object.body),
        };
      }
    }
    this.#updateTelemetry(
      this.#body,
      this.#vehicle,
      this.#control,
      stepSeconds,
      () => this.recover(),
    );
    for (const collisionVehicle of this.#collisionVehicles) {
      this.#updateTelemetry(
        collisionVehicle.body,
        collisionVehicle.controller,
        collisionVehicle.control,
        stepSeconds,
        () => this.#recoverCollisionVehicle(collisionVehicle),
      );
    }
  }

  resetDemo(): void {
    const spawn = this.#activeSpawn;
    this.#placeVehicle(spawn.position, spawn.headingRadians);
    this.#resetCollisionObjects();
  }

  recover(): void {
    const position = this.#body.translation();
    this.#placeVehicle(
      [position.x, Math.max(position.y + this.#config.recovery.lift, this.#activeSpawn.position[1]), position.z],
      headingOf(this.#body.rotation()),
    );
  }

  debugLines(): PhysicsDebugLines {
    const buffers = this.#world.debugRender();
    return { vertices: buffers.vertices, colors: buffers.colors };
  }

  dispose(): void {
    this.#world.removeVehicleController(this.#vehicle);
    for (const collisionVehicle of this.#collisionVehicles) {
      this.#world.removeVehicleController(collisionVehicle.controller);
    }
    this.#eventQueue.free();
    this.#world.free();
  }

  #createArena(RAPIER: RapierModule): void {
    const collisionEvents = RAPIER.ActiveEvents.COLLISION_EVENTS;
    for (let index = 0; index < SURFACE_ORDER.length; index += 1) {
      const surface = SURFACE_ORDER[index];
      if (!surface) {
        continue;
      }
      const body = this.#world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(-12 + index * 8, -0.2, 0)
          .setUserData({ surface } satisfies SurfaceBodyData),
      );
      this.#arenaBodies.push(body);
      this.#world.createCollider(
        RAPIER.ColliderDesc.cuboid(4, 0.2, 35)
          .setFriction(0.9)
          .setRestitution(this.#config.collisionResponse.arenaGroundRestitution)
          .setActiveEvents(collisionEvents),
        body,
      );
    }

    const wallBody = this.#world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.#arenaBodies.push(wallBody);
    const walls: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
      [-16.25, 0.8, 0, 0.25, 1, 35],
      [16.25, 0.8, 0, 0.25, 1, 35],
      [0, 0.8, -35.25, 16, 1, 0.25],
      [0, 0.8, 35.25, 16, 1, 0.25],
    ];
    for (const [x, y, z, halfX, halfY, halfZ] of walls) {
      this.#world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
          .setTranslation(x, y, z)
          .setFriction(0.55)
          .setRestitution(this.#config.collisionResponse.arenaWallRestitution)
          .setActiveEvents(collisionEvents),
        wallBody,
      );
    }
  }

  #setArenaEnabled(enabled: boolean): void {
    this.#arenaBodies.forEach((body) => body.setEnabled(enabled));
  }

  #createCollisionObjects(): void {
    const collisionEvents = this.#RAPIER.ActiveEvents.COLLISION_EVENTS;
    const contactEvents = this.#RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
    for (const spec of ARENA_OBJECT_SPECS) {
      const body = this.#world.createRigidBody(
        this.#RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(...spec.position)
          .setLinearDamping(0.18)
          .setAngularDamping(0.28)
          .setCcdEnabled(true),
      );
      const colliderDesc = spec.kind === "barrel"
        ? this.#RAPIER.ColliderDesc.cylinder(spec.halfExtents[1], spec.halfExtents[0])
        : this.#RAPIER.ColliderDesc.cuboid(...spec.halfExtents);
      colliderDesc
        .setMass(spec.mass)
        .setFriction(0.62)
        .setRestitution(spec.kind === "barrel"
          ? this.#config.collisionResponse.barrelRestitution
          : this.#config.collisionResponse.propRestitution)
        .setActiveEvents(collisionEvents | (spec.destructible ? contactEvents : 0));
      if (spec.destructible) {
        colliderDesc.setContactForceEventThreshold(spec.breakForce);
      }
      const collider = this.#world.createCollider(colliderDesc, body);
      const initial = transformOf(body);
      const object: ArenaObject = {
        id: spec.id,
        kind: spec.kind,
        destructible: spec.destructible,
        active: true,
        breakForce: spec.breakForce,
        colliderHandle: collider.handle,
        body,
        initialPosition: spec.position,
        initialRotation: [0, 0, 0, 1],
        history: { previous: cloneTransform(initial), current: initial },
      };
      this.#arenaObjects.push(object);
      this.#objectByCollider.set(collider.handle, object);
    }
  }

  #createCollisionVehicle(id: string, spawn: VehicleSpawn): void {
    if (id === PRIMARY_VEHICLE_ID || this.#collisionVehicles.some((vehicle) => vehicle.id === id)) {
      throw new Error(`Vehicle id must be unique: ${id}`);
    }
    const created = this.#createChassisBody(spawn);
    const controller = this.#createVehicleController(created.body);
    const initial = transformOf(created.body);
    const object: ArenaObject = {
      id,
      kind: "vehicle",
      destructible: false,
      active: true,
      breakForce: Number.POSITIVE_INFINITY,
      colliderHandle: created.colliderHandle,
      body: created.body,
      initialPosition: spawn.position,
      initialRotation: [initial.rotation[0], initial.rotation[1], initial.rotation[2], initial.rotation[3]],
      history: { previous: cloneTransform(initial), current: initial },
    };
    this.#arenaObjects.push(object);
    this.#collisionVehicles.push({
      id,
      spawn: { position: [...spawn.position], headingRadians: spawn.headingRadians },
      body: created.body,
      controller,
      object,
      control: createVehicleControlState(),
    });
  }

  #resetCollisionObjects(): void {
    for (const object of this.#arenaObjects) {
      object.body.setEnabled(true);
      object.body.setTranslation({
        x: object.initialPosition[0],
        y: object.initialPosition[1],
        z: object.initialPosition[2],
      }, true);
      object.body.setRotation({
        x: object.initialRotation[0],
        y: object.initialRotation[1],
        z: object.initialRotation[2],
        w: object.initialRotation[3],
      }, true);
      object.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      object.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      object.active = true;
      const initial = transformOf(object.body);
      object.history = { previous: cloneTransform(initial), current: initial };
    }
    for (const collisionVehicle of this.#collisionVehicles) {
      this.#resetControlState(collisionVehicle.control);
    }
    this.#world.propagateModifiedBodyPositionsToColliders();
  }

  #applyVehicleControls(
    body: RapierRigidBody,
    vehicle: RapierVehicleController,
    control: VehicleControlState,
    input: VehicleInputFrame,
    stepSeconds: number,
  ): void {
    if (input.drive > 0) {
      control.forwardDriveSeconds += stepSeconds;
      control.reverseDriveSeconds = 0;
    } else if (input.drive < 0) {
      control.reverseDriveSeconds += stepSeconds;
      control.forwardDriveSeconds = 0;
    } else {
      control.forwardDriveSeconds = 0;
      control.reverseDriveSeconds = 0;
    }
    const driveHeldSeconds = input.drive > 0
      ? control.forwardDriveSeconds
      : control.reverseDriveSeconds;
    const driveForceFactor = driveForceBuildUpFactor(
      driveHeldSeconds,
      this.#config.drive.initialThrottleFactor,
      this.#config.drive.throttleRampSeconds,
    );
    const velocity = body.linvel();
    const forward = rotateVector({ x: 0, y: 0, z: 1 }, body.rotation());
    const forwardSpeed = velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;
    const steeringScale = steeringSpeedScale(
      forwardSpeed,
      this.#config.drive.maxForwardSpeed,
      this.#config.drive.steeringSpeedCurve,
      this.#config.drive.steeringSpeedAttenuation,
    );
    const steeringTarget = input.steer * this.#config.drive.maxSteeringAngle * steeringScale;
    control.steeringRadians = approach(
      control.steeringRadians,
      steeringTarget,
      this.#config.drive.steeringResponse * stepSeconds,
    );

    let drive = input.drive;
    let serviceBrake = input.brake * this.#config.drive.serviceBrakeForce;
    let groundedWheels = 0;
    for (let wheel = 0; wheel < vehicle.numWheels(); wheel += 1) {
      groundedWheels += vehicle.wheelIsInContact(wheel) ? 1 : 0;
    }
    const up = rotateVector({ x: 0, y: 1, z: 0 }, body.rotation());
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const counteringBackwardRoll = drive > 0
      && forwardSpeed < 0
      && forwardSpeed > -5
      && horizontalSpeed < 6
      && groundedWheels >= 2
      && up.y > 0.8;
    if (counteringBackwardRoll) {
      body.addForce({
        x: forward.x * this.#config.drive.engineForce * driveForceFactor * 2,
        y: forward.y * this.#config.drive.engineForce * driveForceFactor * 2,
        z: forward.z * this.#config.drive.engineForce * driveForceFactor * 2,
      }, true);
    }
    if (!counteringBackwardRoll
      && Math.abs(forwardSpeed) > this.#config.drive.reverseEngageSpeed
      && Math.sign(drive) !== 0
      && Math.sign(drive) !== Math.sign(forwardSpeed)) {
      serviceBrake = Math.max(serviceBrake, Math.abs(drive) * this.#config.drive.serviceBrakeForce);
      drive = 0;
    }
    if ((forwardSpeed >= this.#config.drive.maxForwardSpeed && drive > 0)
      || (forwardSpeed <= -this.#config.drive.maxReverseSpeed && drive < 0)) {
      drive = 0;
    }

    let groundedDrivenWheels = 0;
    let engineSurfaceMultiplier = 0;
    for (const wheel of this.#config.drive.drivenWheels) {
      const surface = this.#surfaceAtWheel(vehicle, wheel);
      if (surface) {
        groundedDrivenWheels += 1;
        engineSurfaceMultiplier += this.#config.surfaces[surface].engine;
      }
    }
    const surfaceEngine = groundedDrivenWheels === 0
      ? 1
      : engineSurfaceMultiplier / groundedDrivenWheels;
    const engineForce = drive >= 0 ? this.#config.drive.engineForce : this.#config.drive.reverseForce;
    const forcePerWheel = drive * driveForceFactor * engineForce * surfaceEngine
      / this.#config.drive.drivenWheels.length;

    for (let wheel = 0; wheel < vehicle.numWheels(); wheel += 1) {
      const surface = this.#surfaceAtWheel(vehicle, wheel) ?? "asphalt";
      const handling = this.#config.surfaces[surface];
      const rearGrip = REAR_WHEELS.has(wheel)
        ? 1 - input.handbrake * (1 - this.#config.handling.handbrakeRearGrip)
        : 1;
      vehicle.setWheelFrictionSlip(
        wheel,
        this.#config.handling.baseFrictionSlip * this.#sourceHandling.grip * handling.frictionSlip,
      );
      vehicle.setWheelSideFrictionStiffness(
        wheel,
        this.#config.handling.baseSideFriction
          * this.#sourceHandling.handling
          * handling.sideFriction
          * rearGrip,
      );
      // Rapier's +steering direction is mirrored relative to the input contract:
      // positive input means player-right, while the controller expects the opposite sign.
      vehicle.setWheelSteering(wheel, FRONT_WHEELS.has(wheel) ? -control.steeringRadians : 0);
      vehicle.setWheelEngineForce(
        wheel,
        this.#config.drive.drivenWheels.includes(wheel) ? forcePerWheel : 0,
      );
      const handbrake = REAR_WHEELS.has(wheel)
        ? input.handbrake * this.#config.drive.handbrakeForce
        : 0;
      vehicle.setWheelBrake(wheel, serviceBrake + handbrake + handling.rollingBrake);
    }
    if (Math.abs(input.drive) > 0.01 || input.brake > 0.01 || input.handbrake > 0.01) {
      body.wakeUp();
    }
  }

  #applyStability(
    body: RapierRigidBody = this.#body,
    vehicle: RapierVehicleController = this.#vehicle,
  ): void {
    const rotation = body.rotation();
    const velocity = body.linvel();
    const angularVelocity = body.angvel();
    const up = rotateVector({ x: 0, y: 1, z: 0 }, rotation);
    const targetUp = { x: 0, y: 0, z: 0 };
    let groundedWheels = 0;
    for (let wheel = 0; wheel < vehicle.numWheels(); wheel += 1) {
      if (!vehicle.wheelIsInContact(wheel)) {
        continue;
      }
      const normal = vehicle.wheelContactNormal(wheel);
      if (!normal) {
        continue;
      }
      targetUp.x += normal.x;
      targetUp.y += normal.y;
      targetUp.z += normal.z;
      groundedWheels += 1;
    }
    if (groundedWheels === 0) {
      targetUp.y = 1;
    } else {
      const targetLength = Math.hypot(targetUp.x, targetUp.y, targetUp.z);
      if (targetLength > 1e-5) {
        targetUp.x /= targetLength;
        targetUp.y /= targetLength;
        targetUp.z /= targetLength;
      } else {
        targetUp.y = 1;
      }
    }
    const speedSquared = velocity.x * velocity.x + velocity.z * velocity.z;
    body.addForce({ x: 0, y: -speedSquared * this.#config.handling.downforce, z: 0 }, true);
    // up × surfaceUp points along the shortest restoring pitch/roll axis.
    body.addTorque({
      x: (up.y * targetUp.z - up.z * targetUp.y) * this.#config.handling.uprightStrength
        - angularVelocity.x * this.#config.handling.uprightDamping,
      y: 0,
      z: (up.x * targetUp.y - up.y * targetUp.x) * this.#config.handling.uprightStrength
        - angularVelocity.z * this.#config.handling.uprightDamping,
    }, true);
  }

  #surfaceAtWheel(vehicle: RapierVehicleController, wheel: number): SurfaceType | undefined {
    const data = vehicle.wheelGroundObject(wheel)?.parent()?.userData;
    return isSurfaceBodyData(data) ? data.surface : undefined;
  }

  #updateTelemetry(
    body: RapierRigidBody,
    vehicle: RapierVehicleController,
    control: VehicleControlState,
    stepSeconds: number,
    recover: () => void,
  ): void {
    const counts = new Map<SurfaceType, number>();
    let groundedWheels = 0;
    for (let wheel = 0; wheel < vehicle.numWheels(); wheel += 1) {
      if (!vehicle.wheelIsInContact(wheel)) {
        continue;
      }
      groundedWheels += 1;
      const surface = this.#surfaceAtWheel(vehicle, wheel);
      if (surface) {
        counts.set(surface, (counts.get(surface) ?? 0) + 1);
      }
    }
    const velocity = body.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    const rotation = body.rotation();
    const forward = rotateVector({ x: 0, y: 0, z: 1 }, rotation);
    const right = rotateVector({ x: 1, y: 0, z: 0 }, rotation);
    const up = rotateVector({ x: 0, y: 1, z: 0 }, rotation);
    const upsideDown = up.y < this.#config.recovery.maximumUprightDot
      && speed < this.#config.recovery.maximumAutoSpeed;
    control.upsideDownSeconds = upsideDown ? control.upsideDownSeconds + stepSeconds : 0;
    if (control.upsideDownSeconds >= this.#config.recovery.autoDelaySeconds) {
      recover();
    }
    let dominantSurface: SurfaceType | "airborne" = "airborne";
    let dominantCount = 0;
    for (const surface of SURFACE_ORDER) {
      const count = counts.get(surface) ?? 0;
      if (count > dominantCount) {
        dominantSurface = surface;
        dominantCount = count;
      }
    }
    control.telemetry = {
      speedMetersPerSecond: speed,
      forwardSpeedMetersPerSecond: velocity.x * forward.x + velocity.z * forward.z,
      lateralSpeedMetersPerSecond: velocity.x * right.x + velocity.z * right.z,
      headingRadians: headingOf(rotation),
      groundedWheels,
      steeringRadians: control.steeringRadians,
      surface: dominantSurface,
    };
  }

  #drainEvents(): void {
    this.#eventQueue.drainCollisionEvents((colliderA, colliderB, started) => {
      const key = contactKey(colliderA, colliderB);
      if (started) {
        this.#contacts.add(key);
      } else {
        this.#contacts.delete(key);
      }
      this.#events.emit({ type: "physics:contact", colliderA, colliderB, started });
      if (started) {
        this.#events.emit({ type: "audio:cue", cue: "impact", gain: 0.12 });
        this.#events.emit({ type: "renderer:flash", color: 0xff7a42, durationSeconds: 0.12 });
      }
    });
    const impacts = new Map<ArenaObject, number>();
    this.#eventQueue.drainContactForceEvents((event) => {
      const first = this.#objectByCollider.get(event.collider1());
      const second = this.#objectByCollider.get(event.collider2());
      const force = event.totalForceMagnitude();
      for (const object of [first, second]) {
        if (object?.active && object.destructible && force >= object.breakForce) {
          impacts.set(object, Math.max(impacts.get(object) ?? 0, force));
        }
      }
    });
    for (const [object, impactForce] of impacts) {
      this.#destroyObject(object, impactForce);
    }
  }

  #destroyObject(object: ArenaObject, impactForce: number): void {
    const position = object.body.translation();
    object.history = {
      previous: object.history.previous,
      current: transformOf(object.body),
    };
    object.active = false;
    object.body.setEnabled(false);
    for (const key of [...this.#contacts]) {
      const [first, second] = key.split(":").map(Number);
      if (first === object.colliderHandle || second === object.colliderHandle) {
        this.#contacts.delete(key);
      }
    }
    this.#events.emit({
      type: "physics:object-destroyed",
      id: object.id,
      impactForce,
      position: [position.x, position.y, position.z],
    });
    this.#events.emit({ type: "audio:cue", cue: "break", gain: 0.16 });
    this.#events.emit({ type: "renderer:flash", color: 0xffd35c, durationSeconds: 0.18 });
  }

  #recoverCollisionVehicle(vehicle: CollisionVehicleRuntime): void {
    const position = vehicle.body.translation();
    this.#placeVehicleBody(
      vehicle.body,
      [position.x, Math.max(position.y + this.#config.recovery.lift, vehicle.spawn.position[1]), position.z],
      headingOf(vehicle.body.rotation()),
      vehicle.control,
    );
    const initial = transformOf(vehicle.body);
    vehicle.object.history = { previous: cloneTransform(initial), current: initial };
    this.#world.propagateModifiedBodyPositionsToColliders();
    this.#contacts.clear();
    this.#eventQueue.clear();
  }

  #placeVehicle(position: readonly [number, number, number], headingRadians: number): void {
    this.#placeVehicleBody(this.#body, position, headingRadians, this.#control);
    this.#world.propagateModifiedBodyPositionsToColliders();
    this.#contacts.clear();
    this.#eventQueue.clear();
    const initial = transformOf(this.#body);
    this.#history = { previous: cloneTransform(initial), current: initial };
  }

  #placeVehicleBody(
    body: RapierRigidBody,
    position: readonly [number, number, number],
    headingRadians: number,
    control: VehicleControlState,
  ): void {
    body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    body.setRotation(yawRotation(headingRadians), true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const recoveryWasPressed = control.recoveryWasPressed;
    this.#resetControlState(control);
    control.recoveryWasPressed = recoveryWasPressed;
  }

  #resetControlState(control: VehicleControlState): void {
    const reset = createVehicleControlState();
    control.steeringRadians = reset.steeringRadians;
    control.forwardDriveSeconds = reset.forwardDriveSeconds;
    control.reverseDriveSeconds = reset.reverseDriveSeconds;
    control.upsideDownSeconds = reset.upsideDownSeconds;
    control.recoveryWasPressed = reset.recoveryWasPressed;
    control.telemetry = reset.telemetry;
  }
}

export async function createPhysicsRuntime(
  events: RuntimeEventBus,
  stepSeconds = 1 / 60,
  config: VehicleConfig = DEFAULT_VEHICLE_CONFIG,
  options: PhysicsRuntimeOptions = {},
): Promise<PhysicsRuntime> {
  const RAPIER = await import("@dimforge/rapier3d-compat");
  await RAPIER.init();
  return new PhysicsRuntime(RAPIER, events, stepSeconds, config, options);
}
