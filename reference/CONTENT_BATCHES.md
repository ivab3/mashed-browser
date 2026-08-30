# Stage 6 content batches

Status: batches 6.6a (`City` course 26 + `Wildfire`), 6.6b (`Neustein` course 39 + `Crusader`),
and 6.6c (`Arctic` course 0 + `Shorty`) admitted on 2026-08-30. Original files remain in the user's
ignored `game-data/` tree; the repository contains only source-free admission metadata, validators,
and measurements.

## Admission contract

`@mashed/assets` owns `ALPHA_CONTENT_BATCHES`. A batch is admitted only when:

- each track's `COURSE.LUA`, `LAPDATA.LUA`, AI/collision/graphics BSPs, track TXD, declared course
  DFFs, and authored power-up placements or shared course loadout parse through production readers;
- an ordered full-lap rules tape derived from the track's real checkpoint polygons produces the same
  final `LapSession` outcome behind 30, 60, and 120 Hz presentation clocks;
- the ordinary browser file-input binds the route, collision, world, declared models, power-ups, and
  one admitted vehicle without copying source data into the build;
- every file not exercised by that runtime path is classified as deferred, parsed-only, or
  non-runtime. The validator fails on an unclassified track or vehicle file.

Run the local-source gate with:

```bash
pnpm content:validate
```

An alternate extracted `TOASTART` directory can be passed through the package command:

```bash
pnpm --filter @mashed/physics content:validate -- --root "/path/to/TOASTART"
```

## Batch 6.6a — City + Wildfire

The `City` label is the confirmed internal family/course label. This slice does not claim an exact
mapping to one of the localized menu track names. `Wildfire` is used because its display and archive
names match directly, avoiding the still-inferred position mapping of the other vehicle archives.

The repeatable local gate reports:

| Asset | Accepted evidence |
|---|---|
| City route | 117 ordered checkpoints, 5 split checkpoints, one complete deterministic lap at 30/60/120 Hz |
| City world | 28,477 graphics triangles, 2,947 source collision triangles, 76 textures |
| City models | 15 declared DFFs parse, 109 atomics, 4,358 triangles |
| City rules | 18 authored pickup markers; 6 currently resolve to playable non-blank pickups |
| Wildfire | 6 numbered skins, 5 textures, 276 atomics, 36,552 triangles across the six DFFs |

The browser smoke loaded 24 files through the normal chooser. The production adapters bound 117
checkpoints, 2,805 filtered drive/scenery collision triangles, 28,477 rendered world triangles, 101
course atomics, and the intact 13-atomic/3,557-triangle `WILDFIRE0` vehicle. A Hard CPU reached
checkpoint 19 on the loaded route at 60 FPS with zero dropped simulation time. This is the browser
loading smoke; the separate full route-rules replay is the deterministic completion gate.

## Explicit 6.6a boundaries

Supported parsing is intentionally narrower than claiming complete presentation:

- `.AID` tables, `.ANM` animation, `.MTS` authored physics/material templates, `.UVA` animation, and
  `KTCSCRIPT.LUA` are deferred;
- City pickup rules and positions are active, but `POWERUPS_GOLD.DFF` is not rendered;
- `OCCLUDER.DFF`, `FOURLIGHT.DFF`, and `SWINGTYRE.DFF` are not active course references;
- `SKYDOME.DFF`, `TREE.DFF`, `RBARREL.DFF`, and `LIGHTS.DFF` parse but need placement/light behavior
  before rendering; five RWP object-template DFFs also parse without authored instances or MTS physics;
- `.MTS.TXT` sidecars and `RWDEBUG.LOG` are source diagnostics, not runtime inputs;
- Wildfire lights, ghost presentation, and six vehicle-specific debris meshes are deferred. The six
  intact numbered vehicle skins are the admitted roster content.

The exact filenames and reasons live in the batch metadata and are echoed by `pnpm content:validate`.

## Batch 6.6b — Neustein + Crusader

`Neustein` is the confirmed internal family/course label for course 39. The `Crusader` archive's
position suggests the localized vehicle name `Bahnstormer`, but that mapping is not directly named by
the extracted asset. Admission metadata therefore records it as inferred while the browser continues
to display the honest source label `crusader`.

The repeatable local gate reports:

| Asset | Accepted evidence |
|---|---|
| Neustein route | 72 ordered checkpoints, 5 split checkpoints, one complete deterministic lap at 30/60/120 Hz |
| Neustein world | 13,342 graphics triangles, 4,127 source collision triangles, 37 textures |
| Neustein models | 14 declared DFFs parse, 17 atomics, 1,506 triangles |
| Neustein rules | Shared course-39 loadout resolves machine gun, flash, proximity mine, mortar, and guided missile |
| Crusader | 6 numbered skins, 5 textures, 276 atomics, 34,602 triangles across the six DFFs |

The browser smoke loaded 23 files through the normal chooser. The production adapters bound 72
checkpoints, 4,102 filtered drive/scenery collision triangles, 13,342 rendered world triangles, 10
placed course atomics, and the intact 13-atomic/3,037-triangle `CRUSADER0` vehicle. A Hard CPU reached
checkpoint 23 on the loaded route at 60 FPS with zero dropped simulation time. This is the browser
loading smoke; the full route-rules replay remains the deterministic completion gate.

## Explicit 6.6b boundaries

- `.ANM` object/camera animation and `.MTS` material/physics template binding are deferred;
- course 39 uses the shared `POWERUPS_ALL.LUA` loadout; `POWERUPS_GOLD.DFF` is not rendered and no
  authored pickup-position Lua exists in this track directory;
- `POST_01.DFF` is not referenced by the admitted course definition;
- both sky domes, `TRUNK.DFF`, `RBARREL.DFF`, `POST_1.DFF`, `TROLLY_1.DFF`, `CABLECAR.DFF`, and
  `LIGHTS.DFF` parse, but their local-template transforms or light behavior are not instantiated;
- `.MTS.TXT` sidecars are source diagnostics, not runtime inputs;
- Crusader arms, lights, ghost presentation, and six vehicle-specific debris meshes are deferred;
- all six numbered Crusader skins are admitted, but the inferred localized-name mapping remains
  metadata only until direct source evidence is found.

## Batch 6.6c — Arctic + Shorty

Arctic intentionally exercises a second source dialect: its course declares `AI.BSP`, `GRAPH.BSP`,
and `COLLISIONS.BSP`, and its lap line ends with the original `Lap_Line(-1)` sentinel rather than
`Lap_Line_End()`. The production reader now accepts that exact terminal sentinel without exposing it
as a checkpoint, and the browser resolves BSP roles from `COURSE.LUA` regardless of file-selection
order. `Shorty` retains its archive label in the UI because its proposed `Ruckus` display mapping is
position-derived rather than directly named by the asset.

The repeatable local gate reports:

| Asset | Accepted evidence |
|---|---|
| Arctic route | 94 ordered checkpoints, 2 split checkpoints, one complete deterministic lap at 30/60/120 Hz |
| Arctic world | 15,858 graphics triangles, 3,037 source collision triangles, 20 textures |
| Arctic models | 13 declared DFFs parse, 28 atomics, 1,511 triangles |
| Arctic rules | 18 authored pickup markers; 6 currently resolve to playable non-blank pickups |
| Shorty | 6 numbered skins, 5 textures, 276 atomics, 43,836 triangles across the six DFFs |

The browser smoke loaded 22 files through the normal chooser. The production adapters bound 94
checkpoints, 2,960 filtered drive/scenery collision triangles, 15,858 rendered world triangles, 20
placed course atomics, and the intact 13-atomic/5,074-triangle `SHORTY0` vehicle. A Hard CPU reached
checkpoint 8 at 60 FPS with zero dropped simulation time and no console errors. It then remained
blocked by an authored static obstacle during the smoke; full autonomous physics completion on Arctic
is therefore a follow-up, not evidence claimed by this loading/rules admission.

## Explicit 6.6c boundaries

- `.ANM` helicopter/KTC animation, the KTC script, `.MTS` material/physics templates, sea/sky `.UVA`
  playback, and ten wave `.SPL` paths are deferred;
- source pickup positions and rules are active, but `POWERUPS_GOLD.DFF` is not rendered;
- crate, fishing boat, lights, mist, red barrel, both tyre types, sky, and wall DFFs parse but their
  local-template transforms or light behavior are not instantiated;
- four world-authored course DFFs render; the remaining original dynamic behavior and fade/UV logic
  are not claimed;
- Shorty arms, lights, ghost presentation, and six vehicle-specific debris meshes are deferred;
- the current route driver is deterministic on Arctic but is not yet obstacle-aware enough for a
  complete physics lap, so only the full rules replay and partial browser driving smoke are admitted.

Future batches must extend the admission registry rather than weakening or bypassing these checks.
