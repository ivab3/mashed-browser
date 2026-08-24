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
- a damped chase camera that fits all active vehicles, with the Stage 3 orbit/debug camera still
  available;
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
  hard-corner stability, prop impact, and wall impact for the committed or an alternative JSON
  profile;
- an opt-in two-player collision lab whose second vehicle reuses the accepted chassis mass/inertia,
  compound colliders, ray-cast suspension, controls, recovery, and upright stabilization.

The four surfaces are exposed as adjacent strips in the test arena. This is deliberately a tuning
lab rather than a race track. The collision binding is live: selecting a local
`COLLIDE.BSP`/`COLLISIONS.BSP` in the runtime
creates merged static drive/scenery colliders. Track spawn/orientation and lap flow are connected.

The browser URL `?collisionLab=vehicle-pair` replaces the prop line with a blue player-two vehicle
beside P1 on the asphalt lane. Both cars start with the same heading, so P2's arrow-key axes match
P1's screen-relative direction instead of appearing inverted. Each chassis consumes its own
replay-safe input record and publishes its own telemetry; steering the parallel cars into each other
exposes equal-mass side impacts, and reset restores the shared starting row. Both interpolated
vehicle positions participate in the shared camera; P2 still uses a debug render proxy.

The pure camera-fit contract averages active vehicle positions and measures the maximum 3D radius
around that center. The accepted single-car `10 m` trail and `7.2 m` height remain unchanged; both
values grow smoothly with group separation while extreme zoom growth is capped. The primary
vehicle's heading still defines view direction, avoiding a feel change in the accepted chase camera.
At viewport widths up to `820 px`, the telemetry overlay switches to four compact columns so it does
not hide the multiplayer framing.

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
not four cars abreast. The fitted browser Crusader is already about `1.31` m wide. The shared camera
therefore expands around the physical group instead of shrinking visible models below their physics
footprints.

## Data contract

The initial tune lives in [`packages/physics/data/arcade-default.json`](../packages/physics/data/arcade-default.json).
It owns the original vehicle's `Power / Grip / Handling / Drag` source record alongside chassis
dimensions/mass, suspension, drive, grip, stabilization, recovery, and per-surface multipliers.
Physics code consumes the typed `VehicleConfig` contract and accepts an alternative profile at
runtime; vehicle constants do not need code changes. Source Grip and Handling are translated as
relative coefficients anchored to Crusader rather than copied into unrelated Rapier units.

Collision restitution is also part of this data contract. Separate fields cover the chassis, nose,
arena ground/walls, imported track collision, regular props, and barrels so an impact candidate does
not require hardcoded physics edits.

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
applies a rescaled analog deadzone. `PhysicsRuntime.step` receives P1's record and an optional map of
additional records keyed by vehicle ID alongside the fixed timestep. DOM and Gamepad APIs remain out
of physics, so both local-player streams stay deterministic and replay-safe. Telemetry is available
through the legacy P1 getter or `getVehicleTelemetry(id)` for either chassis.

The default drive profile also reproduces the normalized throttle envelope found in `MFL.exe`:
each forward/reverse press starts at 50% force and builds linearly to 100% over six seconds. The
browser's absolute Rapier force remains a browser-side tune because the original executable's raw
drivetrain fields use a different physics path and do not retain their source names.

Crusader's source `Grip = 35000` and `Handling = 0.9` are the neutral `1 / 1` anchor for the
relative handling adapter. Consequently, integrating them changes none of the accepted Crusader
regression metrics; the ratios only affect future vehicle profiles with different source rows.

## Controls

- `W/S` or up/down: accelerate and brake-to-reverse;
- `A/D` or left/right: steer;
- `Shift`: service brake;
- `Space`: handbrake;
- `R`: recover upright at the current horizontal position;
- gamepad: left stick, triggers, A for brake, B for handbrake, Y for recovery;
- `C`: toggle collider debug lines; the panel can enable the orbit camera.

In the vehicle-pair lab the aliases are split into independent streams:

- P1: `WASD`, left `Shift`, `Space`, `R`, and gamepad 1;
- P2: arrow keys, right `Shift`, `Enter`, `\`, and gamepad 2.

These are prototype controls, not a reconstruction of the original keyboard map. The original
files expose `Accelerate`, `Brake/Reverse`, `Fire`, and `Powerup Toggle`; they do not expose a
separate `Handbrake` action. Consequently, `Shift` service brake and `Space` handbrake were added
for the browser handling lab rather than recovered from the game files. The original S/X/arrow/A/D
layout is intentionally not mirrored here.

## Current verification

Physics tests run the same 300-frame steering/braking/handbrake tape through two independent Rapier
worlds and require exact transform and telemetry equality. The vehicle-pair regressions cover
equal-mass impulse transfer, independent P2 movement/telemetry/recovery, and reset of both chassis.
Additional tests cover fixed-timestep rejection, surface profiles, input clamping, analog deadzones,
and separation of the two browser keyboard streams.

The reproducible measurement harness runs with:

```bash
pnpm vehicle:tune
```

It uses the real fixed-step Rapier vehicle and reports acceleration, braking, slalom,
handbrake-turn, hard-corner stability, light-prop impact, and wall-impact metrics. The current regression baseline is stored in
[`reference/vehicle-tuning-baseline.json`](./vehicle-tuning-baseline.json); it describes the browser
prototype and is not presented as a measurement of the original game. The accepted source-mass
baseline reaches 50 km/h in 3.267 s and stops from 45.903 km/h in 6.080 m when the ordinary
brake/reverse drive input is held. The handbrake scenario
increases heading change from 1.341 to 1.618 radians over the same 90-frame turn. The accepted
compliant suspension keeps all four wheels down with 1.619 degrees of peak body tilt. The impact
tape hits the first crate at 37.651 km/h and retains 85.6% of that speed after 0.5 seconds of neutral
input. The accepted zero-bounce obstacle response limits the 69.130 km/h wall probe to a 0.925 km/h
rebound.

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
current deterministic result is 136/136 checkpoints in 61.883 s, 3,713 physics steps, 44.653 km/h peak,
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

- run the seven-scenario A/B session in the reference game, record directional differences, and tune
  the browser profile against those observations;
- record a representative vehicle replay and verify it in every supported browser.

Deferred to the Stage 5 multiplayer vertical slice:

- replace the second player's debug proxy with an independently skinned original vehicle instance.
