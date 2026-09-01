# Track events: source evidence and alpha implementation

## 6.8a — bounded data and deterministic timeline

`MTS` is a count-prefixed sequence of RenderWare matrix chunks, not a material table. Observed files
contain a uint32 count and exactly 76 bytes per entry: matrix chunk `0x0d` with a 64-byte body, nested
struct `0x01` with 52 bytes, twelve float32 basis/translation components and one uint32 flags word.
The reader preserves flags/library ids and rejects inconsistent counts, chunk boundaries, layouts and
non-finite coordinates. No opaque flags are promoted to gameplay behavior.

Local corpus validation on 2026-08-31 parsed all 188 track MTS files / 2,856 matrices. This is format
evidence, not admission of every track. `content:validate` now parses every MTS in each admitted track
and resolves the declared instance filenames. No original file or binary fixture is checked in.

`COURSE.LUA` parsing recognizes `Mts_Filename` and `ExpObj_Clump_Mts_Pair`, including numeric aliases
and optional explosion-profile identities. Missing or duplicate pair references fail closed. The four
admitted tracks declare red-barrel pairs; Warzone additionally declares a hut/profile-1 pair. Original
profile parameters and general Lua control flow are not executed or inferred from an index alone.

`TrackHazardSession` implements a clean-room timeline: impact arms a 0.35-second warning, then emits
a 5-metre / 55-health / 9,000-impulse blast. Nearby armed objects receive their own full warning
interval. Current physical positions, three-dimensional range, stable id order, one-shot destruction,
input validation and round reset are explicit. Recorded impact tapes are identical at 30/60/120 Hz.
These values are alpha tuning, not claims about original Mashed.

At this slice the pure timeline is not yet connected to the browser or combat damage. The next slice
must bind supported source instances, report missing/unsupported pairs, route collision/projectile
impacts into this timeline, apply damage/knockback, and accept reset/pause/chain behavior. M2 remains
open. Original `.ANM` / `KTCSCRIPT.LUA` events and unsupported object families remain separate gaps.

## 6.8b — source barrels in the playable runtime

Attach `COURSE.LUA`, `RBARREL.DFF` and `RBARREL.MTS` with the usual track bundle. MTS parsing runs in
the loading Worker. All 93 admitted barrels bind: City 24, Neustein 37, Arctic 26, Warzone 6. The
renderer uses the original mesh and track texture dictionary; the physical cylinder is fitted to its
local vertex bounds, without the vehicle-specific model scale. Full rigid MTS transforms preserve
fallen barrels. Scaled/sheared/reflected matrices and unsupported model frame layouts fail closed.
Mass (32) and break force (7,000), like explosion settings, are clean-room tuning.

Projectile hits and force-triggered prop destruction feed the same timeline. A blast disables its
physical object, applies 3D radial damage/knockback through `CombatSession`, emits warning/blast
particles and audio, and can arm nearby barrels. Environmental deaths have their own event type,
not a fabricated player/weapon owner. Blast occlusion and original per-profile parameters remain
unreconstructed. The HUD reports armed / fusing / spent counts.

Pause makes no timeline or physics calls. New rounds and Reset restore props, clear queued impacts
and reset all fuses. Loading a new COURSE clears the dedicated model/instance cache before parsing,
so same-named files cannot leak from another track; missing pairs remain inactive and are reported.
Replacing/removing track props preserves generic arena props and the vehicle roster, releases Rapier
bodies and removes old renderer objects. A Warzone hut is explicitly reported as unsupported.

`pnpm track-events:validate` reuses the production binder and checks creation, destruction, reset and
removal for all 93 local source instances. Its scope is binding/lifecycle, not autonomous racing.
Source-free tests additionally cover finite damage, ownerless deaths, rigid transforms, atomic
replacement, stale-cache prevention, and actual Rapier prop destruction plus the combat/timeline
bridge at 30/60/120 Hz. The complete suite has 202 tests.

Browser acceptance on 2026-08-31:

- Arctic's eight-file track/barrel bundle displayed 26 original barrel instances. Solo Hard reached
  checkpoint 82 before two barrel explosions eliminated P1 at 1:50.32 (6,799 steps including countdown).
  This is a natural hazard-death result, **not a completed lap**. Reset restored 26 armed / 0 spent.
- A separate synthetic two-barrel drop fixture, imported through the same file chooser with the local
  original barrel mesh, paused at step 16 with 100 HP and 2 armed. A later inspection was identical;
  after Resume both barrels exploded. P1 stayed out of this fixture's blast range. Reset restored both.
- Loading only a different original COURSE removed those two physics bodies, showed zero hazards and
  requested the new DFF/MTS pair. Both runs recorded no console warning/error; observed frames showed
  60 FPS and zero dropped time. These observations are not a performance benchmark.

The synthetic fixture generator is `tools/qa/track-hazard-fixture.mts`: pass an existing empty temporary
directory, then attach its two generated files plus the user's `RBARREL.DFF` in a fresh tab. It embeds
no original data, uses exclusive file creation and does not modify the source asset directory.

## 6.8c — simultaneous elimination hardening

Eliminations produced in one fixed simulation step are now committed to `RaceSession` as one validated
batch. Last-player-standing is evaluated only after the full batch, so neither combat nor camera order
can invent a survivor. When the active set is empty, every match mode finishes the round with the
explicit `no-survivors` reason, empty winner lists and no score or championship advancement. The next
round retries normally; Flag drops its holder and Fugitive rotates only when that retry starts.

The four modes replay the draw identically at 30/60/120 Hz. Together with race batching regressions,
the complete source-free suite has 211 tests. Browser acceptance used the synthetic fixture moved onto
the default two-player grid: both original barrel meshes exploded in the same run, P1 and P2 became
inactive, the result read `Round 1 ended with no survivors`, both scores stayed 0 / 8, and `Next round`
restored 100 HP plus two armed / zero spent hazards for round 2. The paused reset frame reported zero
dropped simulation time and the console contained no warning/error.
