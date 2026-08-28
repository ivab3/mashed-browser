# Milestone M1 hardening evidence

Status: in progress. The combined match replay matrix and automated 30-minute soak are complete;
target-browser performance and offline checks are the remaining M1 gate.

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

## Remaining evidence

**M1.3 browser acceptance:** capture four-player 1080p frame/physics metrics and prove that a prepared
local asset session performs no game-data network requests after initial loading.
