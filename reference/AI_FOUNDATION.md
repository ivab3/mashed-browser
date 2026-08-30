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

## Post-6.4 refinement boundary

Future tuning may add deliberate pickup pursuit, predictive projectile lead, team coordination, and
more detailed pack behavior. These are refinements rather than blockers for the route-opponent slice.
Semantics from `.AI`/`.LED` should be promoted from neutral fields only when an observable original-game
behavior or stronger binary evidence confirms them.
