# Stage 5 vertical slice

Status: Stage 5 started on 2026-08-28. Deterministic race rules, the production local roster,
shared-camera elimination, the first playable combat loop, and the presentation foundation are
implemented. Original PCM audio and projectile world impacts complete the content/impact follow-up.
The combined 30/60/120 Hz match replay matrix is green; the M1 soak and browser acceptance evidence
remain open before optional post-slice polish.

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

## Slice 5.4 — pickups, projectiles, damage, and destruction

`@mashed/core` now owns a pure fixed-step `CombatSession` for the local roster:

- three data-driven weapon types are playable: a 12-round rapid machine gun, three splash-damage
  rockets, and two delayed-arming proximity mines;
- stable pickup ownership, finite ammo, per-weapon cooldowns, eight-second pickup respawn, projectile
  lifetime, swept hit detection, splash targets, owner immunity, damage, and destruction all use
  simulation time rather than render time;
- plain events report collection, respawn, firing, damage with a world-space knockback impulse,
  destruction, and projectile expiry; replaying the same position/use tape produces the same snapshot;
- keyboard item activation is one-shot on `E` for P1 and `/` for P2; gamepad X is edge-triggered for
  every slot while remaining backward-compatible with older recorded vehicle frames;
- Rapier accepts deterministic per-vehicle combat impulses, and destroyed players flow through the
  existing `RaceSession` `destroyed` elimination reason, last-car-standing result, physics disable,
  shared-camera removal, standings, and rematch reset;
- Three.js renders color-coded pickup and projectile meshes with interpolated projectile positions;
  the live combat HUD exposes health and held weapon/ammo for all active slots;
- temporary synthesized pickup/fire/destroy cues and impact flashes make the loop readable before
  original-audio binding and the production effects pass.

The current projectile contract resolves player hits and lifetime expiry but does not yet collide
projectiles with track/scenery geometry. World impacts, explosion particles, fire trails, damage
decals, and source-authored pickup placement belong to the presentation/content follow-up.

## Slice 5.5 — pause, engine mix, and baseline effects

The complete-match shell now has an explicit, deterministic presentation layer:

- `paused` is a validated runtime state between `race` and `menu`/`race`; the pause button and
  `Escape` toggle it, while page blur or visibility loss pauses an active match automatically;
- pausing freezes the physics, race, combat, elimination, and simulation-step clocks. Resuming resets
  only the presentation anchor, preserving the current step and preventing hidden-time catch-up;
- the match HUD, standings, health, and ammo remain visible below a dedicated pause overlay, while
  roster, asset-loading, finish, and reset controls are locked consistently with match state;
- every active vehicle owns a synthesized engine voice driven by fixed-step speed and throttle
  telemetry; voices fade during pause and are released on menu/results, alongside explicit pause and
  resume UI cues;
- deterministic additive particle bursts distinguish pickup collection, weapon fire, player damage,
  vehicle destruction, and destructible scenery impacts without introducing simulation-side state;
- effect events remain structured-clone-compatible plain data, so future authored effects can replace
  the baseline renderer implementation without coupling core to Three.js.

The engine and UI tones in this slice are an offline-safe fallback. Binding extracted original
engine, collision, weapon, and interface samples is the next content slice.

## Slice 5.6 — original PCM audio and projectile world impacts

The runtime now consumes the user-owned PC sound dictionaries and closes the projectile/world gap:

- `@mashed/assets` validates the nested RenderWare Audio `WAVEDICT → WAVE → header/data` hierarchy,
  accepts the confirmed PC PCM codec GUID, and returns named mono PCM16 samples as transferable data;
- the reader was exercised against all 29 extracted `0x809` dictionaries: 422/422 samples decode at
  22050 Hz. The 30 localized `0x80d` voice streams are intentionally left to a later voice-content
  pass because the vertical slice does not depend on them;
- `.RWS` joins DFF/TXD/BSP in the loading Worker and local file picker. Loading `PERMDICT.RWS`
  registers 45 original samples without copying original bytes into the repository or build;
- per-player `eng1`–`eng4` loops replace synthesized engine voices when present, with playback rate
  driven by speed/throttle. Named original samples cover machine gun, rocket, mine, explosion,
  collision, break, pickup, race-start, pause/resume, and menu cues; synthesis remains the safe
  fallback when no matching bank is loaded;
- moving projectiles submit their fixed-step segment to an injected world query. Rapier raycasts
  track/scenery while excluding vehicle bodies, then reports only a hit fraction, normal, and optional
  prop ID back to the pure combat rules;
- a wall truncates the player-hit segment, rockets splash from the actual world impact, and plain
  `projectile-world-impact` events drive original audio and deterministic particles;
- identified dynamic props receive projectile impulse, while rocket impacts disable destructible
  props through the existing object-destruction event/reset flow.

The world query is an explicit deterministic input to `CombatSession`; replaying the same player
tape and collision answers remains independent of render cadence and of Rapier/Web Audio types.

## Planned slices

1. **M1.1 replay matrix — complete:** the same recorded race/combat/camera scenario produces an
   identical complete snapshot and ordered event log at 30, 60, and 120 Hz presentation rates.
2. **M1.2 soak:** automated 30-minute complete-match soak with finite/bounded-state and reset checks.
3. **M1.3 browser acceptance:** four-player 1080p performance evidence and verification that prepared
   game data causes no network request after initial loading.
4. **Optional polish after M1 evidence:** authored pickup placement, fire trails, damage decals, and
   localized voice-stream playback.

## Verification

The suites cover countdown gating, ordered multi-lap finish, last-player-standing results, fixed-step
camera warnings/elimination/re-entry, independent multiplayer progress, roster/grid validation,
vehicle deactivation/rematch reset, four independent physics slots, asset catalog order,
keyboard/gamepad ownership and item-edge input, three weapon/projectile profiles, swept damage,
knockback/destruction, pickup respawn, world-hit truncation/splash, Rapier world/prop raycasts,
PCM dictionary structure/codec/data lengths, and repeated combat-tape equality. Browser smoke covers live 1→4→1
roster changes, four grounded bodies, repeated `menu → race → results → race`, hidden-row behavior,
combat HUD/pickup draw calls, a constant simulation step throughout pause, continuous step numbering
after resume, prop metrics, and console cleanliness. Run the committed checks with:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm match:replay
```

The accepted matrix and remaining hardening gates are recorded in
[`M1_HARDENING.md`](./M1_HARDENING.md).
