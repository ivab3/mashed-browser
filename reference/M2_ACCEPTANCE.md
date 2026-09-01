# M2 alpha acceptance and compatibility

Status on 2026-09-01: **final gate pending**. Slice 6.7c introduced a repeatable series gate and
consolidated compatibility evidence; slices 6.8a–c added source-positioned hazards and hardened
simultaneous no-survivor rounds. M2 is accepted only after the complete gate below is repeated.

## Reproducible gates

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm alpha:replay
pnpm content:validate
pnpm match:replay
pnpm m1:soak
pnpm ai:lap
pnpm ai:tracks
pnpm track-events:validate
```

`alpha:replay` runs the same clean-room cup definition, match thresholds and ranking function as the
browser. It covers 2/3/4 entrants, the four admitted course identities and 30/60/120 Hz presentation
clocks (36 series). Each series reaches all three natural rule outcomes: last player, 12-second flag
hold with transfer, and 45-second fugitive survival. Six JSON save/restore boundaries cover initial,
between-event and final state; restart must clear scores and medals. Complete snapshots and event logs
must match across clocks. These are recorded **rule frames**, not steering inputs or proof of physical
navigation. Course identities exercise save namespaces, not course geometry.

`content:validate` requires the user's extracted local data. It parses every admitted bundle, rejects
unclassified files, and completes a checkpoint rules replay for each track on 30/60/120 Hz. The other
commands except `ai:lap`, `ai:tracks` and `track-events:validate` are source-independent. No original resource is embedded in a test or report.

## Browser acceptance (6.7c)

The normal file chooser loaded Warzone world, textures, collision, AI BSP, lap/course metadata,
Wildfire and shared power-ups (9 files). Four Hard CPUs completed Standard, Flag and Fugitive without
`Finish round`: 1,225 / 2,647 / 1,084 fixed steps including countdown, with pause/resume exercised in
event two. The last event resolved through fugitive elimination, not a forced 45-second timeout.
Observed frames reported 60 FPS and zero dropped simulation time; this smoke is not a benchmark.
No console warning/error was recorded. This pass exposed survivor-ranking and stale-result-alert
bugs: survivors now precede eliminated entrants, and leaving a match hides elimination warnings.
Ranking policy has a dedicated regression test; prior v1 saves remain readable without rewriting
historical results. A fresh page plus course reattachment restored the same final 15/7/6/5 table;
`New championship` reset all four scores to zero and restarted event one. Original files still require
reattachment after reload; asset caching belongs to Beta.

The 6.8c browser regression loaded the synthetic two-barrel fixture with the user's original barrel
mesh on the default two-player grid. Both vehicles were destroyed, the Standard round ended with no
survivors, both scores remained zero and `Next round` restored 100 HP and both armed barrels. No
warning/error was recorded. This validates the runtime event path; deterministic draw policy across
all four modes is covered separately at 30/60/120 Hz.

## Roadmap coverage

| Requirement | Evidence / current boundary |
| --- | --- |
| Base arsenal | Nine normalized types, timed effects, physical adapters, tactical AI and replay tests; [arsenal notes](ALPHA.md#slice-62--complete-base-arsenal) |
| Key local modes | Standard, Team, Flag and Fugitive rules and browser smoke; objective rules remain clean-room |
| AI | Difficulty profiles, deterministic collision probes and full physical laps on all admitted tracks; two explicit Hard seeds, not all pack scenarios |
| Championship | Shared versioned definition, points, medals, strict restore, restart and `alpha:replay`; original cup schedule is not reconstructed |
| Destruction / traps / scripted events | 93 source-positioned barrels, collision/projectile activation, warning/blast/chain timeline, physical destruction and environmental damage; original hut/ANM/KTC behavior remains unsupported |
| Vehicle roster | All 15 archives / 90 skins parse; all archive skin-0 pairs browser-bound; names other than Wildfire are explicitly inferred metadata |
| Track batches | Four admitted tracks with load smoke and checkpoint rules replay; details below |
| Settings / persistence | CPU, keyboard, deadzone, audio, graphics and independent strict local saves; 6.7d master bus applies live mute to already-playing cues |
| English UI | Production menu, controls, HUD, results and settings are English; untranslated archive labels are source identities |

## Admitted tracks

| Track | Course | Checkpoints | Loading smoke | Autonomous physics boundary |
| --- | ---: | ---: | --- | --- |
| Warzone | 33 | 136 | Full 51-file bundle, natural solo lap | Hard full lap 55.57 s; `ai:lap` / `ai:tracks` |
| City | 26 | 117 | 24 files, world/collision/vehicle bound | Hard full lap 75.20–81.40 s; `ai:tracks` |
| Neustein | 39 | 72 | 23 files, world/collision/vehicle bound | Hard full lap 38.95 s; `ai:tracks` |
| Arctic | 0 | 94 | 22 files, declared nonstandard BSP names; later six-file solo browser lap 4:39.00 | Hard full lap 82.27–175.72 s including settled start, substantial reversing; `ai:tracks` |

Exact measurements and file-family classifications are in [CONTENT_BATCHES.md](CONTENT_BATCHES.md)
and the executable registry `packages/assets/src/content-batches.ts`. A loading smoke or checkpoint
rules replay must never be described as successful autonomous vehicle navigation.

## Explicit incompatible / incomplete resources

- `.AI` / `.LED`: structurally parsed; unconfirmed tables do not drive steering. `.AID`: deferred.
- `.ANM`: authored object/camera/copter animation playback is absent.
- `.MTS`: matrices parse strictly; RBARREL meshes/transforms bind (6.8b), other instance families remain unbound.
- `.UVA`: authored UV animation is absent. Arctic `.SPL` wave paths are deferred.
- `KTCSCRIPT.LUA`: special Kill-the-Copter behavior is not executed; generic Lua execution is prohibited.
- Source RWP objects, non-barrel explosive-object placements, original lights, pickup meshes, ghost/debris variants
  and some excluded/local-template DFFs are parsed-only or deferred as individually recorded.
- Exact original cup ordering/scoring and inferred localized vehicle-name mappings are unconfirmed.
- Source debug logs, editor-only files and `.MTS.TXT` diagnostics are non-runtime inputs.
- Additional tracks outside the admission registry have no alpha compatibility claim.

Beta-only import/cache/offline delivery and a cross-browser matrix are not silently included in this
alpha acceptance. Source-free production build still has the documented large-chunk warning.

## Remaining work before M2 sign-off

1. Repeat every reproducible gate after 6.8c and record the final result.
