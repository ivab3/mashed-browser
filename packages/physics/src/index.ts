import {
  cloneTransform,
  type RuntimeEventBus,
  type SimulationTransform,
} from "@mashed/core";

type RapierModule = typeof import("@dimforge/rapier3d-compat");
type RapierWorld = import("@dimforge/rapier3d-compat").World;
type RapierRigidBody = import("@dimforge/rapier3d-compat").RigidBody;
type RapierEventQueue = import("@dimforge/rapier3d-compat").EventQueue;

export interface PhysicsTransformHistory {
  previous: SimulationTransform;
  current: SimulationTransform;
}

export interface PhysicsMetrics {
  bodies: number;
  colliders: number;
  contacts: number;
}

export interface PhysicsDebugLines {
  vertices: Float32Array;
  colors: Float32Array;
}

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

/** A minimal Rapier world used to verify the runtime boundary before vehicle work starts. */
export class PhysicsRuntime {
  readonly #events: RuntimeEventBus;
  readonly #world: RapierWorld;
  readonly #eventQueue: RapierEventQueue;
  readonly #body: RapierRigidBody;
  readonly #contacts = new Set<string>();
  #history: PhysicsTransformHistory;

  constructor(RAPIER: RapierModule, events: RuntimeEventBus, stepSeconds: number) {
    this.#events = events;
    this.#world = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.#world.timestep = stepSeconds;
    this.#eventQueue = new RAPIER.EventQueue(true);

    const collisionEvents = RAPIER.ActiveEvents.COLLISION_EVENTS;
    this.#world.createCollider(
      RAPIER.ColliderDesc.cuboid(9, 0.25, 9)
        .setTranslation(0, -0.25, 0)
        .setFriction(0.85)
        .setRestitution(0.15)
        .setActiveEvents(collisionEvents),
    );
    this.#body = this.#world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 5, 0)
        .setRotation({ x: 0.12, y: 0.2, z: 0.08, w: 0.97 })
        .setLinvel(1.2, 0, 0.45)
        .setCanSleep(true),
    );
    this.#world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.9, 0.35, 1.45)
        .setDensity(1.1)
        .setFriction(0.72)
        .setRestitution(0.28)
        .setActiveEvents(collisionEvents),
      this.#body,
    );
    const initial = transformOf(this.#body);
    this.#history = { previous: cloneTransform(initial), current: initial };
  }

  get transformHistory(): PhysicsTransformHistory {
    return this.#history;
  }

  get metrics(): PhysicsMetrics {
    return {
      bodies: this.#world.bodies.len(),
      colliders: this.#world.colliders.len(),
      contacts: this.#contacts.size,
    };
  }

  step(stepSeconds: number): void {
    // Rapier stores dt as f32 in WASM, so allow only its representation error.
    if (Math.abs(this.#world.timestep - stepSeconds) > 1e-7) {
      throw new Error(`Physics timestep changed from ${this.#world.timestep} to ${stepSeconds}`);
    }
    this.#history = {
      previous: cloneTransform(this.#history.current),
      current: this.#history.current,
    };
    this.#world.step(this.#eventQueue);
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
    this.#history = {
      previous: this.#history.previous,
      current: transformOf(this.#body),
    };
  }

  resetDemo(): void {
    this.#body.setTranslation({ x: 0, y: 5, z: 0 }, true);
    this.#body.setRotation({ x: 0.12, y: 0.2, z: 0.08, w: 0.97 }, true);
    this.#body.setLinvel({ x: 1.2, y: 0, z: 0.45 }, true);
    this.#body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.#world.propagateModifiedBodyPositionsToColliders();
    this.#contacts.clear();
    this.#eventQueue.clear();
    const initial = transformOf(this.#body);
    this.#history = { previous: cloneTransform(initial), current: initial };
  }

  debugLines(): PhysicsDebugLines {
    const buffers = this.#world.debugRender();
    return { vertices: buffers.vertices, colors: buffers.colors };
  }

  dispose(): void {
    this.#eventQueue.free();
    this.#world.free();
  }
}

export async function createPhysicsRuntime(
  events: RuntimeEventBus,
  stepSeconds = 1 / 60,
): Promise<PhysicsRuntime> {
  const RAPIER = await import("@dimforge/rapier3d-compat");
  await RAPIER.init();
  return new PhysicsRuntime(RAPIER, events, stepSeconds);
}
