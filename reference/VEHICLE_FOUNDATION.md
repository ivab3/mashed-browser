# Stage 4 vehicle foundation

Status: playable single-vehicle lap implemented on 2026-08-24. Stage 4 and Gate C remain open.

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
  pair, fitted to the compact 3.02 m physics footprint and kept in its authored physics `+Z`
  orientation;
- route-aware collision layers that keep vertical scenery out of wheel raycasts, merge adjacent
  sectors to suppress internal-edge artifacts, and provide a continuous support ribbon along the
  AI checkpoint route;
- a deterministic full-lap acceptance driver that uses ordinary `VehicleInputFrame` records and
  completes all 136 Warzone checkpoints without recovery, reverse, or transform overrides;
- a versioned vehicle-feel comparison suite that measures acceleration, braking, slalom, drift,
  hard-corner stability, and impact response for the committed or an alternative JSON profile.

The four surfaces are exposed as adjacent strips in the test arena. This is deliberately a tuning
lab rather than a race track. The collision binding is live: selecting a local
`COLLIDE.BSP`/`COLLISIONS.BSP` in the runtime
creates merged static drive/scenery colliders. Track spawn/orientation and lap flow are connected.

## Original vehicle rendering

Vehicle geometry extensions contain RenderWare User Data plugin `0x11f` arrays named
`0.tv_part_id`. The DFF reader now preserves those values. The intact high-detail selector keeps
the 13 textured body/wheel/glass atomics, uses intact `Glass` instead of `BrokenGlass`, and excludes
attachment markers, collision hulls (`59`–`62`), and complete low-detail shells (`100`–`103`). The
same selector produced the expected atomic indices on both Crusader and Wildfire.

The runtime matches numbered vehicle DFF names to their shared TXD case-insensitively, preferring
skin zero when several variants are loaded. Vehicle textures are owned separately from the track
dictionary, so loading `CRUSADER.TXD` no longer replaces `WARZONE.TXD`.

The generic standalone-DFF convention remains `×5` for world-authored course models. Original
vehicle DFFs are handled separately: their visible high-detail bounds are uniformly fitted to the
current 3.02 m physics length, centered over the chassis, grounded at the suspension footprint, and
kept in its authored `+Z` orientation. Rapier's wheel-steering sign is inverted at the physics
adapter so keyboard/gamepad `left` and `right` match the input contract and the visible car.

The scale audit against original files found a `2.295 × 1.743 × 5.299` world-unit intact Crusader
and an independently authored `2.263 × 1.653 × 5.298` collision envelope in parts `59`–`62` after
the confirmed DFF `×5` conversion. Warzone's first AI corridor is `5.837` m wide and settles to
exactly `5.0` m at the following checkpoints, which is consistent with a two-by-two starting grid,
not four cars abreast. The fitted browser Crusader is already about `1.31` m wide. Its single-car
camera therefore carries extra height and trailing distance as headroom for the later shared-camera
fit instead of shrinking the visible model below its physics footprint.

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

The default drive profile also reproduces the normalized throttle envelope found in `MFL.exe`:
each forward/reverse press starts at 50% force and builds linearly to 100% over six seconds. The
browser's absolute Rapier force remains a browser-side tune because the original executable's raw
drivetrain fields use a different physics path and do not retain their source names.

## Controls

- `W/S` or up/down: accelerate and brake-to-reverse;
- `A/D` or left/right: steer;
- `Shift`: service brake;
- `Space`: handbrake;
- `R`: recover upright at the current horizontal position;
- gamepad: left stick, triggers, A for brake, B for handbrake, Y for recovery;
- `C`: toggle collider debug lines; the panel can enable the orbit camera.

These are prototype controls, not a reconstruction of the original keyboard map. The original
files expose `Accelerate`, `Brake/Reverse`, `Fire`, and `Powerup Toggle`; they do not expose a
separate `Handbrake` action. Consequently, `Shift` service brake and `Space` handbrake were added
for the browser handling lab rather than recovered from the game files. The original S/X/arrow/A/D
layout is intentionally not mirrored here.

## Current verification

Physics tests run the same 300-frame steering/braking/handbrake tape through two independent Rapier
worlds and require exact transform and telemetry equality. Additional tests cover fixed-timestep
rejection, recovery, surface profiles, input clamping, and analog deadzones.

The reproducible measurement harness runs with:

```bash
pnpm vehicle:tune
```

It uses the real fixed-step Rapier vehicle and reports acceleration, braking, slalom,
handbrake-turn, hard-corner stability, and light-prop impact metrics. The current regression baseline is stored in
[`reference/vehicle-tuning-baseline.json`](./vehicle-tuning-baseline.json); it describes the browser
prototype and is not presented as a measurement of the original game. The accepted source-mass
baseline reaches 50 km/h in 3.267 s and brakes from 45.903 km/h in 5.977 m. The handbrake scenario
increases heading change from 1.340 to 1.619 radians over the same 90-frame turn. The hard-corner
tape keeps all four wheels down with 0.926 degrees of peak body tilt. The impact tape hits the first
crate at 37.651 km/h and retains 85.5% of that speed after 0.5 seconds of neutral input.

An alternative data-driven profile can be compared without editing the committed tune:

```bash
pnpm vehicle:tune -- \
  --config reference/captures/crusader-candidate.json \
  --compare reference/vehicle-tuning-baseline.json
```

The human A/B procedure and reference capture contract are documented in
[`reference/VEHICLE_TUNING.md`](./VEHICLE_TUNING.md).

The full-lap acceptance scenario runs with user-owned Warzone assets:

```bash
pnpm lap:validate
```

It binds the original `AI1.BSP`, `COLLIDE.BSP`, and `LAPDATA.LUA`, drives through the same fixed-step
input path as a player, and exits non-zero if the lap is incomplete or recovery was requested. The
current deterministic result is 136/136 checkpoints in 60.983 s, 3,659 physics steps, 44.378 km/h peak,
zero reverse frames, and zero recovery frames. The collision mesh contains 5,833 triangles after
route filtering and application of the 272-triangle compatibility support ribbon.

The collision suite verifies three force-threshold destruction events in a stable order, movement
of the non-destructible dynamic block, and full restoration on reset. The BSP adapter rejects
malformed indices before reaching WASM. A local smoke with the extracted Warzone collision file
created 16 sector colliders containing 5,661 triangles.

A browser smoke with Warzone plus `CRUSADER0.DFF`/`CRUSADER.TXD` bound 13 intact atomics and 3,037
vehicle triangles, retained the 23,077-triangle textured track and 5,661-triangle collision mesh,
held 60 FPS, and reported no console errors. A later idle soak exposed an inverted upright-torque
sign: infinitesimal pitch/roll errors were amplified until the chassis overturned. The restoring
torque now follows `up × surfaceUp`; per-step custom forces/torques are cleared before fresh
downforce, stability, and hill-start assistance are applied. A 15-second neutral-input regression
keeps all four wheels down,
the upright dot above `0.995`, and planar drift below one centimeter. Separate 16-second browser
smokes with the debug proxy and Crusader DFF both held `4/4`, `0 km/h`, asphalt, 60 FPS, zero dropped
time, and a clean console.

Still required before Gate C:

- run the six-scenario A/B session in the reference game, record directional differences, and tune
  the browser profile against those observations;
- add a second vehicle and vehicle/vehicle collision cases;
- add the shared multiplayer camera after multiple active vehicles exist;
- record a representative vehicle replay and verify it in every supported browser.
