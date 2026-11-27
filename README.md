# Mashed: Fully Loaded — browser revival

Clean-room browser reimplementation of _Mashed: Fully Loaded_. The repository contains only
new code, schemas, documentation, and metadata. Original executable and game assets must come
from a user-owned disc image or installed copy and are always kept below ignored `game-data/`.

Milestones **M0: Asset feasibility**, **M1: public proof of concept**, and **M2: feature-complete alpha**
are complete. The accepted Stage 6 boundary includes validated parsing of original per-course power-up
loadouts, authored pickup positions and respawn timings, distinct deterministic rules for all nine base
weapon types, and four multi-round local match modes with persistent scores and objectives. The first AI slice adds per-slot
Human/Easy/Normal/Hard drivers, deterministic checkpoint steering, and structural readers for original
`.AI`/`.LED` data. CPU item use respects each weapon's useful target arc/range, and the production Hard
driver completes the 136-checkpoint Warzone gate without recovery. A clean-room three-event Alpha
Championship adds aggregate points, final medals, next-event flow, and a strict versioned local save
that resumes after navigation. Measured content batches admit City, Neustein, Arctic, and Warzone behind
deterministic full-route gates and cover the complete 15-vehicle, 90-skin roster with explicit
source-free resource boundaries. Runtime-backed CPU, gamepad deadzone, audio, and graphics settings
use a strictly validated versioned local save. Source-positioned barrel hazards add physical
destruction, delayed chain blasts and scoreless simultaneous-elimination draws; deferred source
families remain explicitly listed in the [M2 acceptance report](reference/M2_ACCEPTANCE.md). Stage 1
provides a reproducible local extraction pipeline; Stage 2 provides RenderWare DFF/TXD readers, full
graphical/collision BSP sector parsing, and a Three.js asset viewer. Stage 3 adds a deterministic
fixed-step core, replay checks, Rapier/Three.js/Web Audio adapters, debug tooling, and the browser
runtime shell. Stage 4 and Gate C are complete with a playable data-driven ray-cast vehicle,
keyboard/gamepad controls, four grip surfaces, recovery, a shared multiplayer camera, collision BSP
binding, dynamic/destructible props, a reproducible tuning harness, playable original track sessions,
and runtime-bound original vehicle DFF/TXD models. Stage 5 is complete with a deterministic
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

## Stage 7: import a local library and play offline

Beta delivery slices 7.1–7.2 import an **installed game folder**, extracted `game-data`, or the
reference **Fully Loaded Europe CUE/BIN disc image** directly in the browser. Click **Import game
folder** to select a directory, or **Import disc image** and select the matching `.cue` and `.bin`
files together. Then choose a track and vehicle after import. The production build requires no extractor, Node server,
or `/__mashed` endpoint for game data. A static HTTP host is sufficient; use HTTPS outside localhost.

MODE1/ISO 9660, InstallShield v6, PIZ extraction and resource validation run in a Worker. Resources stay on this device in IndexedDB,
separate from settings and championship saves, and restore automatically on later visits to the
same origin/browser profile. The import shows progress and can be cancelled. After cancellation or
closing the tab, select the same folder or CUE/BIN pair again to resume. Disc extraction restarts,
then saved resource payloads are reused after SHA-256 verification. A new library becomes active only when all selected supported resources validate.

The current admission covers four tracks, 15 vehicles and 90 paints. Unsupported content is not
silently enabled. Browser storage eviction can require reimport.

For offline play (slice 7.3), open the production build once while online. After import,
wait for **Ready to play offline.** in **Local game content**. You can now close the browser
and reopen the same URL offline. To launch it in its own window, use the browser's install
command where available. Installation is optional.

Since slice 7.4 the catalog reads track data when you choose a course. Starting the first
race with sound enabled loads the shared original sound bank. You can also turn sound on during
a muted race. Existing imported libraries support this without another import.

To try the production build locally:

```bash
pnpm --filter @mashed/web build
pnpm --filter @mashed/web exec vite preview --port 4173 --strictPort
```

Open `http://localhost:4173/`. To reuse a previously imported library, serve the build on
the same protocol, hostname and port and use the same browser profile as for the import.
See [Beta delivery verification](reference/BETA_IMPORT.md) for the cold-start check.

Development mode retains the existing local `game-data/` catalog when no browser library exists.

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
pnpm content:validate
pnpm import:validate
pnpm alpha:replay
pnpm ai:tracks
pnpm track-events:validate
pnpm ai:lap
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
Stage 6 alpha slices and their acceptance boundaries live in
[`reference/ALPHA.md`](./reference/ALPHA.md).
AI format findings, route-driver contracts, and follow-up acceptance live in
[`reference/AI_FOUNDATION.md`](./reference/AI_FOUNDATION.md).
Championship rules, source boundaries, and the versioned series-save contract live in
[`reference/CHAMPIONSHIP_FOUNDATION.md`](./reference/CHAMPIONSHIP_FOUNDATION.md).
Content admission batches, repeatable local-source gates, and explicit deferred-resource records live
in [`reference/CONTENT_BATCHES.md`](./reference/CONTENT_BATCHES.md).

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

## Run the Stage 6 alpha runtime

```bash
pnpm web
```

The shell demonstrates the `boot → loading → menu → race ⇄ paused → results` flow, a 60 Hz fixed simulation
clock with interpolated presentation transforms, a live telemetry overlay, an orbit debug camera,
Rapier collider lines, and the first fixed-step race-rules slice. A loaded track route adds a
three-second countdown, ordered one-lap finish, and final-time banner. The local dev server discovers
the admitted content in the ignored `game-data/` tree. Choose a track or vehicle from the in-app
visual catalog instead of opening a native file picker; previews come from the original local
`TRACKIMAGES.TXD`. Choosing a track reads its course definition and playable assets. Choosing
a vehicle reads the selected paint and shared texture dictionary.
DFF/TXD/BSP/RWS files are parsed through the loading Worker; original bytes remain local and parsed
typed arrays are transferred back without cloning. See
[`reference/RUNTIME_FOUNDATION.md`](./reference/RUNTIME_FOUNDATION.md) for runtime contracts and
acceptance evidence. Loading a numbered vehicle DFF such as `CRUSADER0.DFF` together with its shared
`CRUSADER.TXD` is now handled by the catalog when that vehicle and paint are selected.
Measured track admissions currently cover City (course 26), Neustein (course 39), Arctic (course 0),
and Warzone (course 33). The vehicle registry covers all 15 source archives and all 90 intact numbered skins.
`pnpm content:validate` checks every admitted local bundle, runs each track's 30/60/120 Hz route-rules
matrix, and fails if a source file is neither exercised nor explicitly classified. The browser uses
each course's declared BSP filenames, including Arctic's nonstandard names. Inferred localized
vehicle-name mappings stay registry metadata; the runtime keeps source archive labels until direct
evidence exists.
The Settings panel applies CPU presets, gamepad deadzone, master volume/mute, graphics quality, and
eight remappable P1 keyboard actions to the live adapters. Strict versioned local records restore
settings and bindings; malformed or unavailable storage falls back to safe defaults without blocking boot. See
[`reference/ALPHA_SETTINGS.md`](./reference/ALPHA_SETTINGS.md) for the schema and browser acceptance.
Choose 1–4 local players in the runtime roster. P1 defaults to remappable WASD and gamepad 1; P2 uses the arrow keys
and gamepad 2; P3/P4 use gamepads 3/4. Every active slot has independent physics and telemetry, and
can select any complete numbered DFF/shared-TXD pair loaded in the current session. The camera
centers the active group and pulls back as the cars separate; on a loaded route, a trailing player
outside the accepted pack receives a fixed-step warning and is then eliminated. Results list the
complete final order, and `Race again` resets the same match runtime. `/buildings?collisionLab=vehicle-pair`
remains as a compatibility shortcut that defaults to two players and removes the prop line.
Without source metadata, three color-coded combat pickups are placed along the route (or the
handling-lab center lane). Loading `POWERUPS_ALL.LUA` selects the original course loadout; loading a
track's `POWERUPS_GOLD.LUA` also restores authored positions and respawn durations. Machine gun,
guided missile, mortar, rear flame, oil, proximity mine, drum bomb, shotgun, and flash have distinct
rules. Use an item with `E` for P1, `/` for P2, or gamepad X; damage destruction feeds the same
elimination/results flow as camera distance, while oil and flash show timed handling effects in the HUD.
With 2–4 players, choose Standard Play, Team Play, Hold the Flag, or The Fugitive before starting.
The mode HUD tracks the live objective and series score; `Next round` resets race/combat state while
preserving points, and the fugitive role rotates between rounds.
Choose `Alpha Championship` under Game flow to run Standard Play, Hold the Flag, and The Fugitive as
a three-event series on the current route. The championship HUD tracks aggregate `5 / 3 / 2 / 1`
rank points and final medals; `Next event` preserves the table, and the versioned local save resumes
the same course/roster series after navigation. The event order and scoring are clean-room alpha data,
not a claim about the original executable's hidden cup table.
Each roster slot can use a Human, Easy, Normal, or Hard CPU driver once a track route is loaded. CPU
cars submit the same fixed-step vehicle inputs as human adapters; source `.AI`/`.LED` files can be
loaded for validated structural inspection while their still-unconfirmed tables remain out of rules.
Moving projectiles stop on track/scenery, explosives splash from the world hit, and explosive prop
hits use the same destruction/reset flow. When the local library includes `PERMDICT.RWS`,
the first race with sound enabled gains original engine, weapon, collision, explosion, race and menu samples.
Libraries without the optional bank use synthesized sounds.
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
