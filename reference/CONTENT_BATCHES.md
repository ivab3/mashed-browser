# Stage 6 content batches

Status: batch 6.6a (`City` course 26 + `Wildfire`) admitted on 2026-08-30. Original files remain in
the user's ignored `game-data/` tree; the repository contains only source-free admission metadata,
validators, and measurements.

## Admission contract

`@mashed/assets` owns `ALPHA_CONTENT_BATCHES`. A batch is admitted only when:

- each track's `COURSE.LUA`, `LAPDATA.LUA`, AI/collision/graphics BSPs, track TXD, declared course
  DFFs, and authored power-up placements parse through production readers;
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
Future batches must extend that registry rather than weakening or bypassing these checks.
