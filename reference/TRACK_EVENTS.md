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
