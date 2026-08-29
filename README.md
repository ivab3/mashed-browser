# Mashed: Fully Loaded — browser revival

Clean-room browser reimplementation of _Mashed: Fully Loaded_. The repository contains only
new code, schemas, documentation, and metadata. Original executable and game assets must come
from a user-owned disc image or installed copy and are always kept below ignored `game-data/`.

Milestones **M0: Asset feasibility** and **M1: public proof of concept** are complete. Stage 1
provides a reproducible local extraction pipeline; Stage 2 provides RenderWare DFF/TXD readers, full
graphical/collision BSP sector parsing, and a Three.js asset viewer. Stage 3 adds a deterministic
fixed-step core, replay checks, Rapier/Three.js/Web Audio adapters, debug tooling, and the browser
runtime shell. Stage 4 and Gate C are complete with a playable data-driven ray-cast vehicle,
keyboard/gamepad controls, four grip surfaces, recovery, a shared multiplayer camera, collision BSP
binding, dynamic/destructible props, a reproducible tuning harness, playable original track sessions,
and runtime-bound original vehicle DFF/TXD models. Stage 5 is underway with a deterministic
one-to-four-player race session, countdown, independent lap progress, finish/elimination results,
a production 1–4 local roster, heading-aware start grid, independent input/physics streams, and an
original vehicle render instance for every active slot. The third slice adds a route-aware
shared-camera knockout rule, last-car-standing winner, complete standings, and rematch reset without
a page reload. The fourth slice adds deterministic pickups and respawns, machine-gun/rocket/mine
projectiles, damage, Rapier knockback, destruction, synthesized combat cues, and a four-player
health/ammo HUD. The fifth slice adds a deterministic pause/resume state, focus-loss auto-pause,
per-player engine voices, pause/resume cues, and baseline pickup/weapon/damage/destruction particles.
The sixth slice parses original PC RWS dictionaries in the loading Worker, binds named engine/combat/UI
samples with synthesized fallback, and resolves projectile impacts against track/scenery and props.
M1 hardening includes a combined race/combat/camera replay whose complete outcome is identical at
30, 60, and 120 Hz presentation rates, a bounded 30-minute automated rematch soak, and a four-player
production-browser gate at a 2560×1440 WebGL buffer with no post-load asset requests.
[ADR-0001](./reference/ADR-0001-runtime-asset-loading.md) selects direct runtime
parsing in a loading Worker instead of mandatory pre-conversion.

## Requirements

- Node.js 20 or newer;
- pnpm 9;
- [`unshield`](https://github.com/twogood/unshield) available in `PATH` for `.cue/.bin`
  sources.

## Extract assets

```bash
pnpm install
pnpm extract --source "/path/to/game.cue" --out ./game-data
pnpm assets:inspect --manifest ./game-data/manifest.json
```

An installed directory containing exactly one `MFL.exe` can be used instead of a CUE. See
[`tools/extractor/README.md`](./tools/extractor/README.md) for output layout and safety rules.

## Verify the workspace

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm vehicle:tune
pnpm match:replay
pnpm m1:soak
```

Project direction, gates, and scope live in [`ROADMAP.md`](./ROADMAP.md). Reference-build
metadata and acceptance scenarios live in [`REFERENCE.md`](./REFERENCE.md).

Vehicle implementation notes and Gate C acceptance evidence live in
[`reference/VEHICLE_FOUNDATION.md`](./reference/VEHICLE_FOUNDATION.md). The repeatable A/B workflow
for vehicle feel lives in [`reference/VEHICLE_TUNING.md`](./reference/VEHICLE_TUNING.md).
Stage 5 scope, completed slices, and next work live in
[`reference/VERTICAL_SLICE.md`](./reference/VERTICAL_SLICE.md).

## Inspect Stage 2 fixtures

The probe reads extracted local files without copying them into the repository or web build:

```bash
pnpm assets:probe --dff ./game-data/expanded/piz/TOASTART/VEHICLES/Wildfire/WILDFIRE4.DFF
pnpm assets:probe --txd ./game-data/expanded/piz/TOASTART/VEHICLES/Wildfire/WILDFIRE.TXD
pnpm assets:probe --bsp ./game-data/expanded/piz/TOASTART/TRACKS/Warzone/GRAPHICS.BSP
```

Probe output includes geometry formats, material/MatFX semantics, texture sampling flags, decoded
pixel/alpha formats, winding agreement, and frame-basis determinants. For PS2/Xbox native TXD it
reports platform headers instead of mis-decoding their native rasters. Mashed standalone DFF clumps
are shown at their confirmed `×5` world scale; BSP coordinates remain unscaled.

Launch the viewer and select either a matching DFF/TXD pair or `GRAPHICS.BSP`, its TXD, and an
optional `COLLIDE.BSP`/`COLLISIONS.BSP` overlay through the local file controls:

```bash
pnpm asset-viewer
```

Current findings and the remaining Stage 2 questions are tracked in
[`reference/ASSET_SPIKE.md`](./reference/ASSET_SPIKE.md).

## Run the Stage 5 runtime

```bash
pnpm web
```

The shell demonstrates the `boot → loading → menu → race ⇄ paused → results` flow, a 60 Hz fixed simulation
clock with interpolated presentation transforms, a live telemetry overlay, an orbit debug camera,
Rapier collider lines, and the first fixed-step race-rules slice. A loaded track route adds a
three-second countdown, ordered one-lap finish, and final-time banner. Local DFF/TXD/BSP/RWS files can
be parsed through the loading Worker; original
bytes remain local and parsed typed arrays are transferred back without cloning. See
[`reference/RUNTIME_FOUNDATION.md`](./reference/RUNTIME_FOUNDATION.md) for runtime contracts and
acceptance evidence. Loading a numbered vehicle DFF such as `CRUSADER0.DFF` together with its shared
`CRUSADER.TXD` adds it to the local roster selectors.
Choose 1–4 local players in the runtime roster. P1 uses WASD and gamepad 1; P2 uses the arrow keys
and gamepad 2; P3/P4 use gamepads 3/4. Every active slot has independent physics and telemetry, and
can select any complete numbered DFF/shared-TXD pair loaded in the current session. The camera
centers the active group and pulls back as the cars separate; on a loaded route, a trailing player
outside the accepted pack receives a fixed-step warning and is then eliminated. Results list the
complete final order, and `Race again` resets the same match runtime. `/buildings?collisionLab=vehicle-pair`
remains as a compatibility shortcut that defaults to two players and removes the prop line.
Three color-coded combat pickups are placed along the route (or the handling-lab center lane): yellow
machine gun, red rocket, and purple mine. Use an item with `E` for P1, `/` for P2, or gamepad X;
damage destruction feeds the same elimination and results flow as camera distance.
Projectiles stop on track/scenery, rockets splash from the world hit, and explosive prop hits use the
same destruction/reset flow. Load the extracted `PERMDICT.RWS` alongside the track bundle to replace
fallback tones with the original engine, weapon, collision, explosion, race, and menu samples.
Pause with the HUD button or `Escape`; losing page focus pauses automatically. Physics, race, combat,
and elimination steps remain frozen while paused, and resume continues from the same simulation step
without catching up hidden time. Per-player engine pitch tracks speed and throttle with or without the
original bank.

With extracted Warzone assets in the standard ignored `game-data/` location, `pnpm lap:validate`
runs the deterministic 136-checkpoint full-lap acceptance scenario. An alternative track directory
can be passed after the command.

`pnpm vehicle:tune -- --compare reference/vehicle-tuning-baseline.json` runs the seven-scenario
vehicle-feel suite and reports non-zero metric deltas. Pass `--config` with an alternative
`VehicleConfig` JSON file to measure a candidate without changing the committed profile.
