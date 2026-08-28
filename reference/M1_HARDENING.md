# Milestone M1 hardening evidence

Status: in progress. The combined match replay matrix is complete; the 30-minute soak and target
browser performance/offline checks are the remaining M1 gates.

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

## Remaining evidence

1. **M1.2 soak:** run 30 simulated minutes through the complete match stack, assert finite values,
   bounded projectile/particle/object counts, legal state transitions, and repeatable match resets.
2. **M1.3 browser acceptance:** capture four-player 1080p frame/physics metrics and prove that a
   prepared local asset session performs no game-data network requests after initial loading.

