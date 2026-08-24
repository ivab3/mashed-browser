# Mashed: Fully Loaded — browser revival

Clean-room browser reimplementation of _Mashed: Fully Loaded_. The repository contains only
new code, schemas, documentation, and metadata. Original executable and game assets must come
from a user-owned disc image or installed copy and are always kept below ignored `game-data/`.

Milestone **M0: Asset feasibility** and the Stage 3 runtime foundation are complete. Stage 1
provides a reproducible local extraction pipeline; Stage 2 provides RenderWare DFF/TXD readers, full
graphical/collision BSP sector parsing, and a Three.js asset viewer. Stage 3 adds a deterministic
fixed-step core, replay checks, Rapier/Three.js/Web Audio adapters, debug tooling, and the browser
runtime shell. Stage 4 is underway with a playable data-driven ray-cast vehicle, keyboard/gamepad
controls, four grip surfaces, recovery, a shared multiplayer camera, collision BSP binding, dynamic/destructible
props, a reproducible tuning harness, playable original track sessions, and runtime-bound original
vehicle DFF/TXD models.
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
```

Project direction, gates, and scope live in [`ROADMAP.md`](./ROADMAP.md). Reference-build
metadata and acceptance scenarios live in [`REFERENCE.md`](./REFERENCE.md).

Vehicle implementation notes and remaining Gate C work live in
[`reference/VEHICLE_FOUNDATION.md`](./reference/VEHICLE_FOUNDATION.md). The repeatable A/B workflow
for vehicle feel lives in [`reference/VEHICLE_TUNING.md`](./reference/VEHICLE_TUNING.md).

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

## Run the Stage 4 runtime

```bash
pnpm web
```

The shell demonstrates the `boot → loading → menu → race → results` flow, a 60 Hz fixed simulation
clock with interpolated presentation transforms, a live telemetry overlay, an orbit debug camera,
and Rapier collider lines. Local DFF/TXD/BSP files can be parsed through the loading Worker; original
bytes remain local and parsed typed arrays are transferred back without cloning. See
[`reference/RUNTIME_FOUNDATION.md`](./reference/RUNTIME_FOUNDATION.md) for runtime contracts and
acceptance evidence. Loading a numbered vehicle DFF such as `CRUSADER0.DFF` together with its shared
`CRUSADER.TXD` replaces the debug car proxy with the intact original model.
Open `/buildings?collisionLab=vehicle-pair` for the two-player collision lab. P1 uses WASD and
gamepad 1; P2 uses the arrow keys and gamepad 2. The cars start side by side, facing the same way,
and both expose independent live telemetry. The camera centers the active group and pulls back as
the cars separate.

With extracted Warzone assets in the standard ignored `game-data/` location, `pnpm lap:validate`
runs the deterministic 136-checkpoint full-lap acceptance scenario. An alternative track directory
can be passed after the command.

`pnpm vehicle:tune -- --compare reference/vehicle-tuning-baseline.json` runs the seven-scenario
vehicle-feel suite and reports non-zero metric deltas. Pass `--config` with an alternative
`VehicleConfig` JSON file to measure a candidate without changing the committed profile.
