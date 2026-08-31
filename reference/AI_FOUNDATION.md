# Stage 6 AI foundation

Status: slice 6.4 complete on 2026-08-30. The accepted scope is deterministic checkpoint following
through ordinary vehicle inputs, explicit difficulty profiles, structurally characterized original
`.AI`/`.LED` resources, opponent-aware item decisions, an autonomous-lap gate, and browser/runtime
integration.

## Original data characterization

The extracted PC build contains 28 `Common/AI/AI{id}.AI` files and 29 matching-name
`Common/LED/LE{id}.LED` files. IDs are sparse course IDs; ID 7 has an LED file but no AI file. The
readers expose only verified structure and intentionally use neutral names for fields whose gameplay
meaning has not yet been demonstrated.

Both formats are standalone little-endian RenderWare chunks using library ID `0x1c02000a` in the
reference build:

- `.AI` uses custom chunk ID `0x13269902` and is exactly 71,824 bytes including the 12-byte header;
- its 71,812-byte payload contains a 256×256 byte grid, one unsigned 32-bit declared value, two
  fixed tables of 384 float pairs, and a 128-byte trailer;
- across the available source set the declared value ranges from 0 to 510, so it is not treated as a
  table-length assertion;
- `.LED` uses custom chunk ID `0x13269901` and is exactly 4,620 bytes including the header;
- its payload contains 384 fixed float triplets.

`@mashed/assets` rejects wrong IDs, sizes, truncated ranges, trailing data, and non-finite table values.
Local validation parsed all 57 available files and counted 79,887 non-`0xff` AI grid cells. Original
bytes remain below ignored `game-data/` and are never committed.

The browser loader accepts `.AI` and `.LED` and reports their structural summary. These resources do
not yet change steering: the semantics of their grid, tables, and trailer remain unconfirmed. Route
control continues to use the already verified checkpoint polygons from the course's AI BSP ordered by
`LAPDATA.LUA`.

## Deterministic route opponent

`@mashed/core` owns a pure `AiRouteDriver` with no DOM, Rapier, or gamepad dependency. Each fixed step
receives position, heading, speed, and the preceding/current/following checkpoint and returns the same
`drive`, `steer`, `brake`, `handbrake`, `recover`, and `useItem` shape used by human input adapters.

The controller provides:

- checkpoint-width lane bias selected by the seeded gameplay RNG;
- corner/heading severity, target speed, braking, and bounded steering;
- reverse-and-steer escape after a deterministic stuck timeout, without teleport recovery;
- seeded one-shot item decisions;
- weapon-aware target selection: forward delivery requires a target ahead, rear weapons and hazards
  require a target behind, and radial effects require a nearby target; practical range, aim cone,
  decision cadence, and fire chance scale with difficulty;
- Easy, Normal, and Hard profiles with explicit reaction cadence, speed, steering, braking, lane
  variation, escape, and item-use parameters;
- a serializable snapshot for replay diagnostics.

The browser exposes `Human`, `CPU · Easy`, `CPU · Normal`, and `CPU · Hard` per active roster slot.
Selections lock during a race, participate in the multi-round signature, and reset cleanly for each
round. CPU inputs pass through combat status modifiers and then the same `stepVehicles` path as human
inputs. A CPU selected without a loaded route remains neutral rather than silently becoming human.

## Acceptance evidence

- Core unit tests cover steering, difficulty behavior, reaction caching, seeded repeatability, stuck
  escape, and invalid telemetry.
- The recorded AI state tape produces identical input frames, item decisions, RNG state, and final
  snapshot at 30, 60, and 120 Hz presentation rates.
- A production-browser smoke loaded Warzone `AI1.BSP`, `LAPDATA.LUA`, `COLLIDE.BSP`, `AI33.AI`, and
  `LE33.LED`. Normal and Hard CPU drivers remained in the same live Standard Play round; after 18
  seconds P1 had passed 29 of 136 checkpoints and both cars reported 33 km/h, four grounded wheels,
  asphalt contact, and no console errors.
- `pnpm ai:lap` drives the production Hard controller through all 136 Warzone checkpoints using the
  real collision route. The accepted tactical-driver baseline completes in 56.02 seconds (3,361 fixed
  steps), reaches 39.00 km/h, finishes with four grounded wheels, and uses neither reverse escape nor recovery. The
  command fails if the lap is incomplete, exceeds 75 seconds, uses more than 180 reverse frames, or
  requests recovery.
- A second production-browser run loaded Warzone route/collision/course metadata and the original
  global power-up loadout for two Hard CPU drivers. Standard Play reached natural `RESULTS` around 25
  seconds at checkpoint 50/136 with P2 winning, without the debug finish control and without console
  errors. Camera distance resolved that particular round before weapon damage.

## Slice 6.4b — admitted-track navigation gate (2026-08-31)

The original route controller could deadlock within three metres of a checkpoint, chase an overshot
gate in circles and enter short bends too quickly. The production controller now uses a short
crossing/reapproach target, reverse steering toward gates behind the vehicle, deterministic
obstruction escape at any checkpoint distance and a segment-length/curvature speed cap. Wide gates
offer five lane targets; the physics adapter probes each with three bounded chassis-width rays.
Upward road normals do not become walls, and very narrow gates keep their route line instead of
attempting a lateral detour. Browser and CLI feed the same probe data to the pure controller.

`pnpm ai:tracks` discovers every admitted track, resolves AI/collision BSP names through `COURSE.LUA`,
and runs each complete physical lap twice with both the existing acceptance seed and browser P1's
first-round seed. It requires identical reports, a natural finish within 180 seconds, zero recovery
inputs and zero actual recovery operations (including automatic upright recovery). An additional P1
variant settles the chassis for 179 neutral frames, matching the countdown's pre-drive duration.
All 24 laps pass; immediate-start measurements are:

| Track | Acceptance seed | Browser P1 seed | Reverse time range |
| --- | ---: | ---: | ---: |
| City | 81.40 s | 75.20 s | 4.8–6.0 s |
| Neustein | 38.95 s | 38.95 s | 0.017 s |
| Arctic | 86.63 s | 82.27 s | 30.2–31.2 s |
| Warzone | 55.57 s | 55.57 s | 0 s |

Settled P1 laps take City 74.92 s, Neustein 39.10 s, Arctic 175.72 s and Warzone 55.32 s.
A separate browser Arctic smoke (six core track files, solo Hard, proxy vehicle) finishes all 94
checkpoints naturally in 4:39.00 with no console warnings/errors and zero dropped time in observed
frames. Browser scene setup and lap-update ordering differ from this solo physics harness; its times
are not interchangeable. Browser recovery count was not instrumented in this smoke. The wide timing
variation and extensive Arctic reversing remain AI quality work, not a claim of competitive pace.

Arctic completes using considerable reverse manoeuvring; this is functional navigation, not a claim
of polished competitive AI. No checkpoint is skipped, no collision resource is weakened and no
teleport is used to make the gate pass. The stricter historical Warzone `ai:lap` limit remains 75
seconds with at most 180 reverse frames. Source-free tests cover feelers, near-gate escape, reverse
steering, narrow-gate behavior, invalid probe data and 30/60/120 Hz recorded probe determinism.

## Post-6.4 refinement boundary

Future tuning may add deliberate pickup pursuit, predictive projectile lead, team coordination, and
more detailed pack behavior, less Arctic reversing and broader seed/difficulty coverage. The complete
physics gate currently claims solo Hard AI for its two explicit seeds, not every possible pack race.
Semantics from `.AI`/`.LED` should be promoted from neutral fields only when an observable original-game
behavior or stronger binary evidence confirms them.
