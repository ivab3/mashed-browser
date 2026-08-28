# Stage 5 vertical slice

Status: Stage 5 started on 2026-08-28. The deterministic race-rules foundation is implemented; the
full multiplayer, combat, presentation, audio, and hardening slices remain open.

## Slice 5.1 — race rules foundation

`@mashed/core` now owns a pure `RaceSession` above the existing ordered `LapSession`. The session:

- validates one to four unique local players and a positive race distance;
- runs a fixed-step countdown without accepting early checkpoint progress;
- tracks independent ordered checkpoint and multi-lap progress for every player;
- emits plain-data countdown, start, checkpoint, lap, finish, elimination, and race-result events;
- exposes explicit `camera-distance`, `destroyed`, and `retired` elimination reasons without coupling
  core to camera, physics, DOM, or rendering code;
- ranks finishers by race time and surviving eliminated players ahead of players eliminated earlier;
- produces identical snapshots when the same multiplayer position tape is replayed.

The browser runtime creates a one-player, one-lap `RaceSession` when a complete track route is
loaded. The accepted vehicle is held on neutral input through the three-second countdown, receives
control at `race-started`, and transitions to `results` only after returning through every ordered
checkpoint. A central HUD banner renders the countdown and final time. The asset-free handling lab
keeps its immediate manual simulation flow so Stage 4 tuning remains available.

This is the rules substrate for the vertical slice, not completion of the Stage 5 gameplay bullet.
The off-screen camera policy still needs to decide when to call `eliminatePlayer`, additional cars
need production render/physics slots, and combat damage will later call the same elimination boundary.

## Planned slices

1. **Local roster:** data-driven four-car selection, spawn grid, four independent input/physics
   streams, and an original render instance for every active player.
2. **Multiplayer match:** all player positions connected to `RaceSession`, shared-camera distance
   elimination, restart/rematch flow, and final standings for complete matches.
3. **Combat:** pickups plus at least three weapons/power-ups, damage, knockback, projectiles, and
   deterministic destruction/elimination events.
4. **Presentation:** production HUD, pause, results, engine/impact/weapon/UI audio, and baseline
   effects usable for a complete battle/race loop.
5. **M1 hardening:** browser replay matrix, 30-minute soak, four-player 1080p performance scene,
   and verification that prepared game data causes no network request after initial loading.

## Verification

The core suite covers countdown gating, ordered multi-lap finish, independent multiplayer progress,
elimination ordering, validation errors, and repeated position-tape equality. The web smoke covers
`menu → race → results`, the Stage 4 asset-free fallback, and console cleanliness. Run the committed
checks with:

```bash
pnpm test
pnpm typecheck
pnpm build
```
