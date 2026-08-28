# Stage 5 vertical slice

Status: Stage 5 started on 2026-08-28. Deterministic race rules, the production local roster, and
shared-camera match elimination are implemented; combat, presentation, audio, and hardening remain open.

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
The off-screen camera policy still needs to decide when to call `eliminatePlayer`, and combat damage
will later call the same elimination boundary.

## Slice 5.2 — production local roster

The prototype-only primary/P2 split is replaced by one canonical local roster:

- stable `vehicle-one` through `vehicle-four` slots own P1–P4 labels and gamepad indices;
- a pure, tested grid builder places one centered car, two abreast, or up to four cars in a compact
  heading-aware two-by-two starting grid around the authored track spawn;
- physics can activate or disable any 1–4 slot roster, publishes transform/telemetry by ID, and
  accepts every player's fixed-step input through one `stepVehicles` map;
- P1/P2 keep independent keyboard streams while P3/P4 are explicitly gamepad-only; one-player mode
  retains the combined WASD/arrow binding;
- the asset catalog exposes every complete numbered DFF/shared-TXD pair instead of selecting only
  one preferred vehicle;
- the renderer can bind a separate intact original DFF/TXD instance to every active physics slot;
  color-coded proxies remain available when local original assets are not loaded;
- the browser menu selects 1–4 players and a loaded vehicle/skin for each slot, then feeds all active
  positions into `RaceSession` and the shared camera.

All four slots currently share the accepted Crusader physics profile. Per-vehicle source-stat
profiles are a later content/tuning concern; this slice makes visual selection and runtime ownership
data-driven without pretending that unverified car-specific Rapier tunes are already complete.

## Slice 5.3 — shared-camera elimination and complete matches

The multiplayer race loop now resolves a full last-car-standing match without page reloads:

- a pure fixed-step `CameraEliminationTracker` selects the route leader by lap, ordered-checkpoint
  progress, and distance to the next checkpoint, with stable roster order as its final tie-breaker;
- non-leaders outside the accepted leader/pack radius receive a 1.5-second warning before elimination;
  returning to the camera pack clears the accumulated danger time;
- simultaneous eliminations retain deterministic input order, and the final racing player receives
  an explicit `winner` result before the match enters `results`;
- finished, eliminated, and winning vehicles are disabled in Rapier and removed from the shared
  camera while their final transforms and result records remain available;
- the renderer follows the first remaining active vehicle when P1 is out and holds the last camera
  pose after every vehicle becomes terminal;
- the runtime presents the knockout countdown and complete ordered standings; `Race again` resets
  physics, race progress, elimination timers, and presentation without reloading the page.

The elimination policy consumes track progress and positions as plain data. It does not depend on
Three.js screen coordinates, DOM timing, or render FPS, so later combat destruction can use the same
`RaceSession.eliminatePlayer` boundary.

## Planned slices

1. **Combat:** pickups plus at least three weapons/power-ups, damage, knockback, projectiles, and
   deterministic destruction/elimination events.
2. **Presentation:** production HUD, pause, results, engine/impact/weapon/UI audio, and baseline
   effects usable for a complete battle/race loop.
3. **M1 hardening:** browser replay matrix, 30-minute soak, four-player 1080p performance scene,
   and verification that prepared game data causes no network request after initial loading.

## Verification

The suites cover countdown gating, ordered multi-lap finish, last-player-standing results, fixed-step
camera warnings/elimination/re-entry, independent multiplayer progress, roster/grid validation,
vehicle deactivation/rematch reset, four independent physics slots, asset catalog order,
keyboard/gamepad ownership, and repeated position-tape equality. Browser smoke covers live 1→4→1
roster changes, four grounded bodies, repeated `menu → race → results → race`, hidden-row behavior,
prop metrics, and console cleanliness. Run the committed checks with:

```bash
pnpm test
pnpm typecheck
pnpm build
```
