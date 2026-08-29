# Stage 6 feature-complete alpha

Status: in progress since 2026-08-29. Stage 5/M1 is the stable baseline. Alpha work expands the
single-track proof of concept through small deterministic slices; original resources remain local and
every connected track must gain both a loading smoke test and a replay test.

## Slice 6.1 — source-authored power-up foundation

The first alpha slice replaces hard-coded content assumptions with validated original metadata:

- `@mashed/assets` recognizes every power-up ID present in the extracted PC
  `POWERUPS_ALL.LUA` and `POWERUPS_GOLD.LUA` files;
- declarative Lua calls are parsed without evaluating Lua or accepting arbitrary code;
- the global registry exposes 26 course loadouts in stable course-ID order;
- per-track files expose source positions, types, and individual respawn durations;
- the runtime accepts both metadata files through the existing local-file flow;
- source placements initially drove the three Stage 5 combat equivalents and now feed the complete
  normalized arsenal from slice 6.2;
- when only `POWERUPS_ALL.LUA` is available, the selected course loadout chooses supported weapon
  types while route checkpoints provide temporary placement. The Stage 5 three-pickup layout remains
  the asset-free fallback.

The reader is verified against all six extracted placement files: 83 authored markers parse, including
blank authoring markers, and the global file yields 26 course loadouts. No original Lua is committed.

## Slice 6.2 — complete base arsenal

The nine weapon types named by the original training text now have distinct fixed-step rules:

- machine gun keeps rapid forward rounds and per-hit knockback;
- guided missiles steer toward the nearest live opponent while retaining deterministic world hits;
- mortar rounds use a gravity-driven arc and splash damage;
- the rear flame creates a short-lived damage hazard and gives the firing vehicle a small forward
  impulse;
- oil creates an armed rear hazard and temporarily reduces the victim's steering authority;
- proximity mines retain delayed arming, long lifetime, and explosive knockback;
- drum bombs launch backwards and deliver a high-damage direct/splash hit;
- shotgun emits a short-range blast around the car for alongside opponents;
- flash applies a timed disorientation effect without direct damage.

Every source type in the extracted loadout/placement files maps to one of these behaviors; old
`rocket` and `mine` names remain compatibility aliases for the accepted Stage 5 replay. Status
durations live in the combat snapshot, expire on simulation time, modify browser input only at the
adapter boundary, and are visible in the per-player HUD. Renderer geometry/colors and named original
audio cues cover every weapon with synthesis fallback.

The complete workspace suite, production builds, 30/60/120 Hz M1 replay matrix, and accelerated
30-minute soak remain green after the expansion.

## Slice 6.3a — local mode rule substrate

`@mashed/core` now owns a pure `MatchModeSession` above the existing per-round race/combat rules:

- Standard Play awards a point to the last active player;
- Team Play validates exactly two teams and awards a team score when the opposing team is out;
- Hold the Flag models capture, transfer, drop, continuous hold time, and the point threshold;
- The Fugitive rotates the role between rounds and resolves either survival/lap completion or an
  explicit interceptor;
- every mode owns deterministic multi-round scores, point target, round-complete and terminal phases,
  and plain-data events/snapshots;
- invalid rosters, team assignments, active-player frames, and round transitions fail explicitly.

The substrate deliberately has no DOM, Rapier, camera, or rendering dependency. Runtime selection,
flag proximity/presentation, and persistent score HUD are the next half of slice 6.3.

## Planned slices

1. **6.3b match-mode runtime:** connect Standard Play, Team Play, Hold the Flag, and The Fugitive to
   roster selection, objective/score HUD, round resets, and replay coverage.
2. **6.4 AI opponents:** decode or characterize the per-course `.AI`/`.LED` data, build route steering
   on the existing ordered checkpoints, and add deterministic difficulty profiles and replay tapes.
3. **6.5 tournament flow:** main-menu to event-series progression, championship results, local save
   schema, and English UI strings.
4. **6.6 content batches:** full vehicle roster and tracks in measured batches. Every admitted track
   gets a load smoke, rules replay, and an explicit unsupported-resource record.
5. **6.7 settings and alpha gate:** controls/audio/graphics/difficulty settings, persistence, complete
   menu-to-series acceptance, and the Milestone M2 compatibility report.

This order may interleave a content batch after a new mode or weapon family so the abstractions are
validated on more than Warzone before they spread across the full catalog.

## Verification

Run the source-independent committed checks with:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Local source-data validation additionally parses every extracted `POWERUPS_GOLD.LUA` and the shared
`POWERUPS_ALL.LUA`; it reports counts and normalized types without copying their contents.
