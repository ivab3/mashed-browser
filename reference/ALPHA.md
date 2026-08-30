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

## Slice 6.3 — local match modes

`@mashed/core` now owns a pure `MatchModeSession` above the existing per-round race/combat rules:

- Standard Play awards a point to the last active player;
- Team Play validates exactly two teams and awards a team score when the opposing team is out;
- Hold the Flag models capture, transfer, drop, continuous hold time, and the point threshold;
- The Fugitive rotates the role between rounds and resolves either survival/lap completion or an
  explicit interceptor;
- every mode owns deterministic multi-round scores, point target, round-complete and terminal phases,
  and plain-data events/snapshots;
- invalid rosters, team assignments, active-player frames, and round transitions fail explicitly.

The substrate deliberately has no DOM, Rapier, camera, or rendering dependency. The browser adapter
connects it to the 2–4 player roster, race/combat eliminations, lap completion, a visible flag or
fugitive objective, a persistent score HUD, and same-page round resets. The selected mode is locked
during play; `Next round` preserves the series score and rotates the fugitive, while terminal results
offer a fresh match. The four rule families each have a recorded fixed-step replay whose complete
outcome is identical at 30, 60, and 120 Hz presentation rates.

Production-browser smoke covered starting, resolving, and advancing Standard Play plus resolving Team
Play, Hold the Flag, and The Fugitive with four local players. All transitions reached the expected
race/results state without console errors.

## Slice 6.4 — deterministic AI opponents

The first AI slice adds per-slot Human/Easy/Normal/Hard selection and a pure fixed-step route driver.
CPU cars follow the verified ordered checkpoint polygons through the same input, combat-status, and
Rapier vehicle path as human cars. Seeded lane choice, item decisions, reaction cadence, corner speed,
braking, and stuck escape are replayable; the recorded driver outcome is identical at 30, 60, and
120 Hz presentation rates.

Item decisions now require an opponent in the held weapon's useful delivery arc and range. Easy,
Normal, and Hard profiles vary aim cone, practical range, cadence, and fire chance. `pnpm ai:lap`
completes all 136 Warzone checkpoints with the production Hard controller in 56.02 seconds without
reverse/recovery, and a two-Hard-CPU browser round reaches natural results without debug completion.

`@mashed/assets` also structurally decodes the original fixed-size `.AI` and `.LED` RenderWare chunks.
All 28 AI and 29 LED files in the local reference set parse, but unconfirmed tables retain neutral
names and do not influence steering. Detailed format findings, browser evidence, and the 6.4b boundary
live in [AI_FOUNDATION.md](./AI_FOUNDATION.md).

## Slice 6.5 — championship series

A pure `ChampionshipSession` owns an ordered multi-event series, explicit rank points, deterministic
standings/tie breakers, final medals, and strict event transitions. Its versioned save contract is
fully revalidated on restore rather than trusted as typed input. Extracted English identifiers confirm
the original championship/tournament/cup vocabulary, but no standalone source event table was found,
so the alpha cup remains explicitly clean-room and data-driven.

The browser menu now switches between a single match and a three-event Alpha Championship on the
current route. Event mode, briefing, aggregate standings, awarded points, next-event transition, final
medals, and fresh-series restart are visible in the production UI. A failure-tolerant local adapter
persists the strict versioned save by course and roster size. Browser acceptance completed the full
series, restored its final table after navigation, and restarted it at zero points. Details live in
[CHAMPIONSHIP_FOUNDATION.md](./CHAMPIONSHIP_FOUNDATION.md).

## Slices 6.6a–c — first measured content batches

The first admission beyond the Warzone proof baseline adds City (course 26) and Wildfire. A
source-free batch registry records stable identities and every deferred/parsed-only resource family.
`pnpm content:validate` parses the complete admitted bundle and fails on any unclassified source file.
City's 117-checkpoint full-lap rules replay is identical at 30, 60, and 120 Hz. The ordinary browser
loader binds City world/collision/course data plus the intact Wildfire model; a Hard CPU crossed the
first 19 checkpoints at 60 FPS with no dropped simulation time.

The second admission adds Neustein (course 39) and Crusader. Its 72-checkpoint full-lap rules replay
is also identical at 30, 60, and 120 Hz, and the shared course loadout resolves all five source weapon
types through production readers. The browser binds 13,342 rendered world triangles, 4,102 filtered
collision triangles, and the intact Crusader model; a Hard CPU crossed checkpoint 23 at 60 FPS with no
dropped simulation time. The unconfirmed `Crusader` → `Bahnstormer` position mapping remains metadata
instead of being presented as fact. Measurements and exact boundaries live in
[CONTENT_BATCHES.md](./CONTENT_BATCHES.md).

The third admission adds Arctic (course 0) and Shorty while closing two cross-catalog assumptions:
the lap reader now accepts the original terminal `Lap_Line(-1)` sentinel, and the browser binds
nonstandard BSP filenames through `COURSE.LUA` declarations rather than filename guesses. Arctic's
94-checkpoint rules replay is identical across 30/60/120 Hz, and its 18 authored pickup markers feed
the production combat adapter. Browser loading binds the complete world/collision/Shorty bundle at
60 FPS with no dropped time or console errors. The Hard route driver reaches checkpoint 8 before an
authored obstacle exposes the next AI-physics follow-up; autonomous Arctic completion is not claimed.

## Planned slices

1. **6.6d+ content batches:** extend the vehicle roster and tracks in measured batches. Every admitted
   track keeps the load smoke, rules replay, and explicit unsupported-resource record.
2. **6.7 settings and alpha gate:** controls/audio/graphics/difficulty settings, persistence, complete
   menu-to-series acceptance, and the Milestone M2 compatibility report.

This order may interleave a content batch after a new mode or weapon family so the abstractions are
validated on more than Warzone before they spread across the full catalog.

## Verification

Run the source-independent committed checks with:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm content:validate
```

Local source-data validation additionally parses every extracted `POWERUPS_GOLD.LUA` and the shared
`POWERUPS_ALL.LUA`; it reports counts and normalized types without copying their contents.
