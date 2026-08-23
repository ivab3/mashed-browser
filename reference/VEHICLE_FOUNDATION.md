# Stage 4 vehicle foundation

Status: first playable slice implemented on 2026-08-24. Stage 4 and Gate C remain open.

## Implemented slice

The runtime now replaces the falling Stage 3 proxy with a fixed-step arcade vehicle:

- one dynamic chassis with two attached box colliders, a lowered center of mass, CCD, and explicit
  mass/inertia;
- four Rapier ray-cast wheels with spring stiffness, compression/relaxation damping, travel, and
  force limits;
- forward drive, brake-to-reverse behavior, service brake, speed-sensitive steering, and a rear
  handbrake grip reduction;
- upright stabilization, manual recovery, and automatic recovery after remaining inverted at low
  speed;
- keyboard and standard-gamepad input sampled once per simulation step;
- asphalt, ice, sand, and mud handling profiles selected from the collider under each wheel;
- a damped chase camera with the Stage 3 orbit/debug camera still available.
- dynamic crates, a barrel, and a heavy block; force-threshold props emit deterministic destruction
  events and are restored with the race reset;
- a validated plain-data boundary that turns parsed collision BSP world sectors into Rapier trimeshes.

The four surfaces are exposed as adjacent strips in the test arena. This is deliberately a tuning
lab rather than a race track. The collision binding is live: selecting a local
`COLLIDE.BSP`/`COLLISIONS.BSP` in the runtime
creates one static collider per non-empty sector. Track spawn/orientation and lap flow remain open.

## Data contract

The initial tune lives in [`packages/physics/data/arcade-default.json`](../packages/physics/data/arcade-default.json).
It owns chassis dimensions/mass, suspension, drive, grip, stabilization, recovery, and per-surface
multipliers. Physics code consumes the typed `VehicleConfig` contract and accepts an alternative
profile at runtime; vehicle constants do not need code changes.

`VehicleInputFrame` is plain replay-safe data:

```ts
interface VehicleInputFrame {
  drive: number;      // -1 reverse, +1 forward
  steer: number;      // -1 left, +1 right
  brake: number;      // 0..1
  handbrake: number;  // 0..1
  recover: boolean;
}
```

The browser adapter converts keyboard/gamepad state to this record, clamps invalid values, and
applies a rescaled analog deadzone. `PhysicsRuntime.step` receives the record alongside the fixed
timestep, keeping DOM and Gamepad APIs out of physics and preserving deterministic input tapes.

## Controls

- `W/S` or up/down: accelerate and brake-to-reverse;
- `A/D` or left/right: steer;
- `Shift`: service brake;
- `Space`: handbrake;
- `R`: recover upright at the current horizontal position;
- gamepad: left stick, triggers, A for brake, B for handbrake, Y for recovery;
- `C`: toggle collider debug lines; the panel can enable the orbit camera.

## Current verification

Physics tests run the same 300-frame steering/braking/handbrake tape through two independent Rapier
worlds and require exact transform and telemetry equality. Additional tests cover fixed-timestep
rejection, recovery, surface profiles, input clamping, and analog deadzones.

The reproducible measurement harness runs with:

```bash
pnpm vehicle:tune
```

It uses the real fixed-step Rapier vehicle without collision props and reports acceleration,
braking, slalom, and handbrake-turn metrics. The current regression baseline is stored in
[`reference/vehicle-tuning-baseline.json`](./vehicle-tuning-baseline.json); it describes the browser
prototype and is not presented as a measurement of the original game. The first baseline reaches
50 km/h in 3.433 s and brakes from 44.879 km/h in 6.033 m. The handbrake scenario increases heading
change from 1.575 to 1.882 radians over the same 90-frame turn.

The collision suite verifies three force-threshold destruction events in a stable order, movement
of the non-destructible dynamic block, and full restoration on reset. The BSP adapter rejects
malformed indices before reaching WASM. A local smoke with the extracted Warzone collision file
created 16 sector colliders containing 5,661 triangles.

Still required before Gate C:

- tune against repeatable acceleration, braking, slalom, drift, impact, and rollover scenarios in
  the reference game;
- choose track spawn/orientation and complete a full lap on the bound collision mesh;
- add a second vehicle and vehicle/vehicle collision cases;
- add the shared multiplayer camera after multiple active vehicles exist;
- record a representative vehicle replay and verify it in every supported browser.
