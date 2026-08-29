# Milestone M1 hardening evidence

Status: complete on 2026-08-29. The combined match replay matrix, automated 30-minute soak, and
production-browser performance/offline checks are green.

## M1.1 — combined match replay matrix

Run the committed matrix with:

```bash
pnpm match:replay
```

The scenario records 60 Hz fixed-step player transforms, item use, checkpoint distances, and world
collision answers as plain data. One runner composes the production pure-rule boundaries:

- `RaceSession` for race time, elimination, last-player-standing, and ranked results;
- `CameraEliminationTracker` for grace warnings and deterministic off-pack knockout;
- `CombatSession` for pickup, rocket fire, wall impact, splash damage, and destruction;
- `FixedStepClock` for presentation at 30, 60, and 120 Hz.

Accepted result on 2026-08-28:

| Presentation | Frames to result | Processed fixed steps | Outcome |
| ---: | ---: | ---: | --- |
| 30 Hz | 53 | 105 | P1 winner; P2/P3 camera KO; P4 destroyed |
| 60 Hz | 105 | 105 | identical |
| 120 Hz | 210 | 105 | identical |

The command compares the complete race snapshot, combat snapshot, and ordered event log—not only the
winner. It exits non-zero on any divergence. The browser fixed-step callback also stops mutating all
sessions immediately after a terminal event; this matters when one 30 Hz presentation frame contains
two 60 Hz simulation callbacks.

## M1.2 — automated 30-minute soak

Run the accepted soak with:

```bash
pnpm m1:soak
```

The accelerated harness ran 1,029 complete matches across alternating 30/60/120 Hz presentation
rates for 1,800.75 simulated seconds (108,045 fixed steps). Every rematch reconstructed the complete
rules stack and matched the baseline snapshot/event log exactly. Fifty-two matches also exercised
the legal `race → paused → race` path; all 2,164 runtime state transitions passed through the
production `RuntimeStateMachine`.

Accepted bounds on 2026-08-28:

| Invariant | Observed peak/result | Accepted budget |
| --- | ---: | ---: |
| Live projectiles | 9 | ≤ 12 |
| Combat runtime objects | 15 | ≤ 18 |
| Concurrent renderer bursts | 8 | ≤ 8 |
| Concurrent particles | 125 | ≤ 128 |
| Retained heap after explicit GC | +425,472 bytes | < 16 MiB |
| Non-finite snapshot values | 0 | 0 |
| Reset divergences | 0 / 1,029 | 0 |

The renderer budgets are derived from the production combat-event mapping and advanced on the same
fixed-step event timeline. Browser/WebGL resource counts and frame-time evidence remain part of M1.3.

## M1.3 — production browser performance and offline assets

Build and serve the production app, then open `/?m1Evidence=1`:

```bash
pnpm --filter @mashed/web build
pnpm --filter @mashed/web exec vite preview --host 127.0.0.1 --port 4173
```

Evidence mode makes the canvas full-window, selects four local players, and exposes a bounded sampler.
Load the user-owned track/vehicle/audio bundle through the normal file chooser, start the match, allow
the initial load and countdown to finish, choose **Reset sample**, then **Capture report** after at
least five seconds. Reset also clears Resource Timing, so any later runtime/asset request is included
in `networkRequestsAfterReset`. The gate refuses to pass an asset-free run.

Accepted production run on an Apple M1 MacBook Air (8 GB memory, 7-core integrated GPU):

| Measurement | Result |
| --- | ---: |
| Prepared inputs | Warzone route/collision/graphics/TXD, Crusader DFF/TXD, PERMDICT RWS |
| Loaded source data | 7 binary assets + 2 LUA metadata files; 136 checkpoints |
| CSS viewport / device scale | 1280×720 / 2× |
| WebGL drawing buffer | 2560×1440 (above 1920×1080) |
| Sample | 528 frames / 8.783 s |
| FPS median / p05 / minimum | 60.01 / 59.97 / 59.93 |
| Frame time median / p95 / maximum | 16.70 / 17.70 / 17.80 ms |
| Physics time median / p95 / maximum | 0.70 / 0.90 / 2.80 ms |
| Simulation | 527 steps; 0 dropped seconds |
| Active vehicles | 4 |
| Peak render load | 175 draws; 26,573 triangles; 75 geometries; 47 textures |
| Physics world | 15 bodies; 22 colliders |
| Requests after post-load reset | 0 |
| Browser console errors | 0 |

The machine-readable acceptance requires 300+ samples over 5+ seconds, four active vehicles, at least
one prepared binary asset, a drawing buffer of at least 1920×1080, median FPS ≥59, p95 frame time
≤20 ms, zero dropped simulation time, and zero resource requests after the post-load reset. All flags
passed in the accepted run.

The captured machine-readable report is committed as
[`m1-browser-evidence-2026-08-29.json`](./m1-browser-evidence-2026-08-29.json).
