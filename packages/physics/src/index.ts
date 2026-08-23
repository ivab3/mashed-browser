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
  type SurfaceHandlingConfig,
  type SurfaceType,
  type VehicleConfig,
} from "./vehicle-config.js";
import {
  DEFAULT_VEHICLE_CONFIG,
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

export type PhysicsSceneObjectKind = "crate" | "barrel" | "block";

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
}

interface SurfaceBodyData {
  surface: SurfaceType;
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

function contactKey(handleA: number, handleB: number): string {
  return handleA < handleB ? `${handleA}:${handleB}` : `${handleB}:${handleA}`;
}

function approach(current: number, target: number, maximumDelta: number): number {
  if (current < target) {
    return Math.min(target, current + maximumDelta);
  }
  return Math.max(target, current - maximumDelta);
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
  readonly #contacts = new Set<string>();
  readonly #arenaObjects: ArenaObject[] = [];
  readonly #objectByCollider = new Map<number, ArenaObject>();
  #trackBody: RapierRigidBody | undefined;
  #trackTriangles = 0;
  #activeSpawn: VehicleSpawn;
  #history: PhysicsTransformHistory;
  #steeringRadians = 0;
  #upsideDownSeconds = 0;
  #recoveryWasPressed = false;
  #telemetry: VehicleTelemetry = {
    speedMetersPerSecond: 0,
    forwardSpeedMetersPerSecond: 0,
    lateralSpeedMetersPerSecond: 0,
    headingRadians: 0,
    groundedWheels: 0,
    steeringRadians: 0,
    surface: "airborne",
  };

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
    this.#activeSpawn = {
      position: [...this.#config.spawn.position],
      headingRadians: this.#config.spawn.headingRadians,
    };
    this.#world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.#world.timestep = stepSeconds;
    this.#eventQueue = new RAPIER.EventQueue(true);
    this.#createArena(RAPIER);

    const { chassis, spawn } = this.#config;
    const rotation = yawRotation(spawn.headingRadians);
    this.#body = this.#world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...spawn.position)
        .setRotation(rotation)
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
    this.#world.createCollider(
      RAPIER.ColliderDesc.cuboid(...chassis.halfExtents)
        .setMass(0)
        .setFriction(0.22)
        .setRestitution(0.08)
        .setActiveEvents(collisionEvents),
      this.#body,
    );
    this.#world.createCollider(
      RAPIER.ColliderDesc.cuboid(...chassis.noseHalfExtents)
        .setTranslation(...chassis.noseOffset)
        .setMass(0)
        .setFriction(0.2)
        .setRestitution(0.12)
        .setActiveEvents(collisionEvents),
      this.#body,
    );

    this.#vehicle = this.#world.createVehicleController(this.#body);
    this.#vehicle.indexUpAxis = 1;
    this.#vehicle.setIndexForwardAxis = 2;
    for (const connection of this.#config.wheels.connectionPoints) {
      this.#vehicle.addWheel(
        { x: connection[0], y: connection[1], z: connection[2] },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        this.#config.wheels.suspensionRestLength,
        this.#config.wheels.radius,
      );
    }
    for (let wheel = 0; wheel < this.#vehicle.numWheels(); wheel += 1) {
      this.#vehicle.setWheelMaxSuspensionTravel(wheel, this.#config.wheels.maxSuspensionTravel);
      this.#vehicle.setWheelSuspensionStiffness(wheel, this.#config.wheels.suspensionStiffness);
      this.#vehicle.setWheelSuspensionCompression(wheel, this.#config.wheels.suspensionCompression);
      this.#vehicle.setWheelSuspensionRelaxation(wheel, this.#config.wheels.suspensionRelaxation);
      this.#vehicle.setWheelMaxSuspensionForce(wheel, this.#config.wheels.maxSuspensionForce);
      this.#vehicle.setWheelFrictionSlip(wheel, this.#config.handling.baseFrictionSlip);
      this.#vehicle.setWheelSideFrictionStiffness(wheel, this.#config.handling.baseSideFriction);
    }
    if (options.collisionObjects !== false) {
      this.#createCollisionObjects();
    }
    const initial = transformOf(this.#body);
    this.#history = { previous: cloneTransform(initial), current: initial };
  }

  get transformHistory(): PhysicsTransformHistory {
    return this.#history;
  }

  get telemetry(): VehicleTelemetry {
    return { ...this.#telemetry };
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

  setTrackCollision(sectors: readonly StaticCollisionSector[]): number {
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

    this.#trackBody = this.#world.createRigidBody(
      this.#RAPIER.RigidBodyDesc.fixed().setUserData({ surface: "asphalt" } satisfies SurfaceBodyData),
    );
    const activeEvents = this.#RAPIER.ActiveEvents.COLLISION_EVENTS;
    for (const sector of validSectors) {
      this.#world.createCollider(
        this.#RAPIER.ColliderDesc.trimesh(sector.positions, sector.indices)
          .setFriction(0.9)
          .setRestitution(0.03)
          .setActiveEvents(activeEvents),
        this.#trackBody,
      );
      this.#trackTriangles += sector.indices.length / 3;
    }
    return this.#trackTriangles;
  }

  clearTrackCollision(): void {
    if (this.#trackBody) {
      this.#world.removeRigidBody(this.#trackBody);
      this.#trackBody = undefined;
    }
    this.#trackTriangles = 0;
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

  step(stepSeconds: number, rawInput: VehicleInputFrame = NEUTRAL_VEHICLE_INPUT): void {
    if (Math.abs(this.#world.timestep - stepSeconds) > 1e-7) {
      throw new Error(`Physics timestep changed from ${this.#world.timestep} to ${stepSeconds}`);
    }
    const input = sanitizeVehicleInput(rawInput);
    const requestedRecovery = input.recover && !this.#recoveryWasPressed;
    this.#recoveryWasPressed = input.recover;
    if (requestedRecovery) {
      this.recover();
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
    this.#applyVehicleControls(input, stepSeconds);
    this.#vehicle.updateVehicle(stepSeconds, undefined, undefined, (collider) => (
      collider.parent()?.handle !== this.#body.handle
    ));
    this.#applyStability();
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
    this.#updateTelemetry(stepSeconds);
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
      this.#world.createCollider(
        RAPIER.ColliderDesc.cuboid(4, 0.2, 35)
          .setFriction(0.9)
          .setRestitution(0.04)
          .setActiveEvents(collisionEvents),
        body,
      );
    }

    const wallBody = this.#world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
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
          .setRestitution(0.18)
          .setActiveEvents(collisionEvents),
        wallBody,
      );
    }
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
        .setRestitution(spec.kind === "barrel" ? 0.28 : 0.12)
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
        history: { previous: cloneTransform(initial), current: initial },
      };
      this.#arenaObjects.push(object);
      this.#objectByCollider.set(collider.handle, object);
    }
  }

  #resetCollisionObjects(): void {
    for (const object of this.#arenaObjects) {
      object.body.setEnabled(true);
      object.body.setTranslation({
        x: object.initialPosition[0],
        y: object.initialPosition[1],
        z: object.initialPosition[2],
      }, true);
      object.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      object.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      object.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      object.active = true;
      const initial = transformOf(object.body);
      object.history = { previous: cloneTransform(initial), current: initial };
    }
    this.#world.propagateModifiedBodyPositionsToColliders();
  }

  #applyVehicleControls(input: VehicleInputFrame, stepSeconds: number): void {
    const velocity = this.#body.linvel();
    const forward = rotateVector({ x: 0, y: 0, z: 1 }, this.#body.rotation());
    const forwardSpeed = velocity.x * forward.x + velocity.y * forward.y + velocity.z * forward.z;
    const speedRatio = Math.min(1, Math.abs(forwardSpeed) / this.#config.drive.maxForwardSpeed);
    const steeringScale = 1 - speedRatio * (1 - this.#config.drive.highSpeedSteering);
    const steeringTarget = input.steer * this.#config.drive.maxSteeringAngle * steeringScale;
    this.#steeringRadians = approach(
      this.#steeringRadians,
      steeringTarget,
      this.#config.drive.steeringResponse * stepSeconds,
    );

    let drive = input.drive;
    let serviceBrake = input.brake * this.#config.drive.serviceBrakeForce;
    if (Math.abs(forwardSpeed) > this.#config.drive.reverseEngageSpeed
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
      const surface = this.#surfaceAtWheel(wheel);
      if (surface) {
        groundedDrivenWheels += 1;
        engineSurfaceMultiplier += this.#config.surfaces[surface].engine;
      }
    }
    const surfaceEngine = groundedDrivenWheels === 0
      ? 1
      : engineSurfaceMultiplier / groundedDrivenWheels;
    const engineForce = drive >= 0 ? this.#config.drive.engineForce : this.#config.drive.reverseForce;
    const forcePerWheel = drive * engineForce * surfaceEngine / this.#config.drive.drivenWheels.length;

    for (let wheel = 0; wheel < this.#vehicle.numWheels(); wheel += 1) {
      const surface = this.#surfaceAtWheel(wheel) ?? "asphalt";
      const handling = this.#config.surfaces[surface];
      const rearGrip = REAR_WHEELS.has(wheel)
        ? 1 - input.handbrake * (1 - this.#config.handling.handbrakeRearGrip)
        : 1;
      this.#vehicle.setWheelFrictionSlip(
        wheel,
        this.#config.handling.baseFrictionSlip * handling.frictionSlip,
      );
      this.#vehicle.setWheelSideFrictionStiffness(
        wheel,
        this.#config.handling.baseSideFriction * handling.sideFriction * rearGrip,
      );
      this.#vehicle.setWheelSteering(wheel, FRONT_WHEELS.has(wheel) ? this.#steeringRadians : 0);
      this.#vehicle.setWheelEngineForce(
        wheel,
        this.#config.drive.drivenWheels.includes(wheel) ? forcePerWheel : 0,
      );
      const handbrake = REAR_WHEELS.has(wheel)
        ? input.handbrake * this.#config.drive.handbrakeForce
        : 0;
      this.#vehicle.setWheelBrake(wheel, serviceBrake + handbrake + handling.rollingBrake);
    }
    if (Math.abs(input.drive) > 0.01 || input.brake > 0.01 || input.handbrake > 0.01) {
      this.#body.wakeUp();
    }
  }

  #applyStability(): void {
    const rotation = this.#body.rotation();
    const velocity = this.#body.linvel();
    const angularVelocity = this.#body.angvel();
    const up = rotateVector({ x: 0, y: 1, z: 0 }, rotation);
    const speedSquared = velocity.x * velocity.x + velocity.z * velocity.z;
    this.#body.addForce({ x: 0, y: -speedSquared * this.#config.handling.downforce, z: 0 }, true);
    // up × worldUp points along the shortest restoring pitch/roll axis.
    this.#body.addTorque({
      x: -up.z * this.#config.handling.uprightStrength - angularVelocity.x * this.#config.handling.uprightDamping,
      y: 0,
      z: up.x * this.#config.handling.uprightStrength - angularVelocity.z * this.#config.handling.uprightDamping,
    }, true);
  }

  #surfaceAtWheel(wheel: number): SurfaceType | undefined {
    const data = this.#vehicle.wheelGroundObject(wheel)?.parent()?.userData;
    return isSurfaceBodyData(data) ? data.surface : undefined;
  }

  #updateTelemetry(stepSeconds: number): void {
    const counts = new Map<SurfaceType, number>();
    let groundedWheels = 0;
    for (let wheel = 0; wheel < this.#vehicle.numWheels(); wheel += 1) {
      if (!this.#vehicle.wheelIsInContact(wheel)) {
        continue;
      }
      groundedWheels += 1;
      const surface = this.#surfaceAtWheel(wheel);
      if (surface) {
        counts.set(surface, (counts.get(surface) ?? 0) + 1);
      }
    }
    const velocity = this.#body.linvel();
    const speed = Math.hypot(velocity.x, velocity.z);
    const rotation = this.#body.rotation();
    const forward = rotateVector({ x: 0, y: 0, z: 1 }, rotation);
    const right = rotateVector({ x: 1, y: 0, z: 0 }, rotation);
    const up = rotateVector({ x: 0, y: 1, z: 0 }, rotation);
    const upsideDown = up.y < this.#config.recovery.maximumUprightDot
      && speed < this.#config.recovery.maximumAutoSpeed;
    this.#upsideDownSeconds = upsideDown ? this.#upsideDownSeconds + stepSeconds : 0;
    if (this.#upsideDownSeconds >= this.#config.recovery.autoDelaySeconds) {
      this.recover();
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
    this.#telemetry = {
      speedMetersPerSecond: speed,
      forwardSpeedMetersPerSecond: velocity.x * forward.x + velocity.z * forward.z,
      lateralSpeedMetersPerSecond: velocity.x * right.x + velocity.z * right.z,
      headingRadians: headingOf(rotation),
      groundedWheels,
      steeringRadians: this.#steeringRadians,
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

  #placeVehicle(position: readonly [number, number, number], headingRadians: number): void {
    this.#body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    this.#body.setRotation(yawRotation(headingRadians), true);
    this.#body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.#body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.#world.propagateModifiedBodyPositionsToColliders();
    this.#contacts.clear();
    this.#eventQueue.clear();
    this.#steeringRadians = 0;
    this.#upsideDownSeconds = 0;
    const initial = transformOf(this.#body);
    this.#history = { previous: cloneTransform(initial), current: initial };
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
