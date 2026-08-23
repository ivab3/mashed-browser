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
- a damped chase camera with the Stage 3 orbit/debug camera still available;
- dynamic crates, a barrel, and a heavy block; force-threshold props emit deterministic destruction
  events and are restored with the race reset;
- a validated plain-data boundary that turns parsed collision BSP world sectors into Rapier trimeshes;
- a playable track session assembled from graphical/collision/AI BSP, TXD, COURSE/LAPDATA metadata,
  world-authored DFF clumps, ordered checkpoints, and the original track spawn;
- runtime replacement of the debug car proxy by a matching `NAME0.DFF`–`NAME5.DFF` plus `NAME.TXD`
  pair, rendered at the confirmed DFF `×5` world scale.

The four surfaces are exposed as adjacent strips in the test arena. This is deliberately a tuning
lab rather than a race track. The collision binding is live: selecting a local
`COLLIDE.BSP`/`COLLISIONS.BSP` in the runtime
creates one static collider per non-empty sector. Track spawn/orientation and lap flow are connected;
driving and validating a complete lap remains open.

## Original vehicle rendering

Vehicle geometry extensions contain RenderWare User Data plugin `0x11f` arrays named
`0.tv_part_id`. The DFF reader now preserves those values. The intact high-detail selector keeps
the 13 textured body/wheel/glass atomics, uses intact `Glass` instead of `BrokenGlass`, and excludes
attachment markers, collision hulls (`59`–`62`), and complete low-detail shells (`100`–`103`). The
same selector produced the expected atomic indices on both Crusader and Wildfire.

The runtime matches numbered vehicle DFF names to their shared TXD case-insensitively, preferring
skin zero when several variants are loaded. Vehicle textures are owned separately from the track
dictionary, so loading `CRUSADER.TXD` no longer replaces `WARZONE.TXD`.

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
prototype and is not presented as a measurement of the original game. The corrected stability
baseline reaches 50 km/h in 3.433 s and brakes from 44.879 km/h in 5.985 m. The handbrake scenario
increases heading change from 1.575 to 1.88 radians over the same 90-frame turn.

The collision suite verifies three force-threshold destruction events in a stable order, movement
of the non-destructible dynamic block, and full restoration on reset. The BSP adapter rejects
malformed indices before reaching WASM. A local smoke with the extracted Warzone collision file
created 16 sector colliders containing 5,661 triangles.

A browser smoke with Warzone plus `CRUSADER0.DFF`/`CRUSADER.TXD` bound 13 intact atomics and 3,037
vehicle triangles, retained the 23,077-triangle textured track and 5,661-triangle collision mesh,
held 60 FPS, and reported no console errors. A later idle soak exposed an inverted upright-torque
sign: infinitesimal pitch/roll errors were amplified until the chassis overturned. The restoring
torque now follows `up × worldUp`; a 15-second neutral-input regression keeps all four wheels down,
the upright dot above `0.995`, and planar drift below one centimeter. Separate 16-second browser
smokes with the debug proxy and Crusader DFF both held `4/4`, `0 km/h`, asphalt, 60 FPS, zero dropped
time, and a clean console.

Still required before Gate C:

- tune against repeatable acceleration, braking, slalom, drift, impact, and rollover scenarios in
  the reference game;
- complete a full lap on the bound collision mesh;
- add a second vehicle and vehicle/vehicle collision cases;
- add the shared multiplayer camera after multiple active vehicles exist;
- record a representative vehicle replay and verify it in every supported browser.
