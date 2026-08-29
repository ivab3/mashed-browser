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
- source placements drive the three already playable combat equivalents: gun, guided missile, and
  mine. Unsupported alpha weapons remain visible in parsed metadata but are deliberately not
  substituted with the wrong behavior;
- when only `POWERUPS_ALL.LUA` is available, the selected course loadout chooses supported weapon
  types while route checkpoints provide temporary placement. The Stage 5 three-pickup layout remains
  the asset-free fallback.

The reader is verified against all six extracted placement files: 83 authored markers parse, including
blank authoring markers, and the global file yields 26 course loadouts. No original Lua is committed.

## Planned slices

1. **6.2 complete base arsenal:** add deterministic rules and presentation for mortar, shotgun,
   rear flame, oil, flash, drum/detonator, guided missile, and both mine variants; bind the parsed
   source types directly instead of filtering them.
2. **6.3 match modes:** factor mode policy above race/combat sessions and implement Standard Play,
   Team Play, Hold the Flag, and The Fugitive before the special arcade challenges.
3. **6.4 AI opponents:** decode or characterize the per-course `.AI`/`.LED` data, build route steering
   on the existing ordered checkpoints, and add deterministic difficulty profiles and replay tapes.
4. **6.5 tournament flow:** main-menu to event-series progression, championship results, local save
   schema, and English UI strings.
5. **6.6 content batches:** full vehicle roster and tracks in measured batches. Every admitted track
   gets a load smoke, rules replay, and an explicit unsupported-resource record.
6. **6.7 settings and alpha gate:** controls/audio/graphics/difficulty settings, persistence, complete
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
