# ADR-0001: Parse original RenderWare assets at runtime

- Status: accepted
- Date: 2026-08-23
- Scope: DFF, platform-independent PC TXD, graphical BSP and collision BSP

## Context

The browser runtime needs geometry, materials, textures and collision data from user-owned Mashed
files. The Stage 2 choice was between reading the original formats at load time and requiring a
pre-conversion step to glTF/GLB, KTX2 and/or a custom binary format.

The current readers already preserve details that do not map one-to-one to standard glTF material
semantics: RenderWare frame/atomic structure, texture sampling flags, prelit colors, multiple UV
sets, MatFX dual blending, world sectors and the separate collision world. A mandatory converter
would therefore still need custom extensions and a versioned compatibility layer.

The representative loading set was measured locally with Node 20 after three warm-up passes and
20 measured passes. These numbers are development-machine evidence, not a browser performance
guarantee:

| Asset | Source size | Decoded typed arrays | Median parse | p95 parse |
| --- | ---: | ---: | ---: | ---: |
| Wildfire DFF | 280,670 B | 261,408 B | 1.43 ms | 1.63 ms |
| Wildfire TXD | 389,244 B | 1,497,768 B | 18.23 ms | 19.53 ms |
| Warzone graphical BSP | 1,231,680 B | 1,179,142 B | 6.58 ms | 6.87 ms |
| Warzone collision BSP | 223,030 B | 160,486 B | 0.96 ms | 2.22 ms |
| Warzone TXD | 1,101,364 B | 3,828,364 B | 46.62 ms | 47.49 ms |

The combined median is 72.76 ms and p95 is 74.80 ms. Parsing is a one-time loading operation;
texture decode dominates the result. Only the selected track, cars and shared assets need to be in
the active working set.

## Decision

Original PC DFF/TXD/BSP files are the canonical runtime input. The project will not require an
offline glTF/KTX2/custom-binary conversion step for the first playable version.

The loading boundary will be:

```text
user-owned extracted files
          │ ArrayBuffer + manifest identity
          ▼
loading Worker ──> @mashed/assets readers ──> transferable asset DTOs
                                                   │
                          ┌────────────────────────┴───────────────────────┐
                          ▼                                                ▼
                    Three.js renderer                               Rapier adapter
```

Rules for the implementation:

1. `packages/assets` remains deterministic and platform-agnostic. It accepts byte arrays and must
   not depend on DOM, Three.js, Rapier or Node filesystem APIs.
2. File selection, directory access and fetch are source adapters outside the parser package.
3. Parsing moves off the main thread into a loading Worker during Stage 3. Parsed typed arrays are
   transferred rather than cloned where practical.
4. Runtime loads only the current track, selected vehicles and required shared assets. A loading
   state owns parsing and GPU upload; parsing never runs inside the simulation step.
5. The extraction manifest path and SHA-256 identify source data and future cache entries. An
   in-memory cache is sufficient initially; a persistent derived cache is optional.
6. The existing asset viewer and CLI probe keep using the same readers, so diagnostic behavior and
   game loading cannot silently diverge.

## Why not mandatory conversion now

| Criterion | Runtime parsing | Mandatory conversion |
| --- | --- | --- |
| Fidelity to observed RenderWare/MatFX data | Direct | Requires custom glTF extensions or custom schema |
| User workflow | Extract, then load | Extract, convert, version and load |
| Current implementation | Readers and validation already work | New converter, cache invalidation and loaders required |
| Representative CPU cost | About 75 ms p95 before GPU upload | Lower runtime cost, but paid in preprocessing |
| Texture/GPU efficiency | RGBA expansion in memory | KTX2 could reduce upload size and GPU memory |
| Future optimization | Worker and hash-keyed derived cache | Built in, at the cost of a second canonical representation |

The principal conversion benefit would be GPU-compressed KTX2 textures. The measured active TXD
decode is about 5.3 MB of typed RGBA data for Wildfire plus Warzone, so that optimization is not yet
needed to establish a playable runtime.

## Consequences and revisit triggers

Stage 3 must introduce the Worker loading boundary before gameplay begins. Browser timings and peak
memory must be recorded on at least one mid-range target machine; the Node measurements above are
only the Stage 2 decision baseline.

Add an optional converter or persistent derived cache if profiling shows any of the following:

- p95 parsing for one representative race working set exceeds 250 ms on a supported desktop;
- texture decode/upload causes visible loading stalls after Worker parsing;
- active texture memory becomes a practical GPU budget problem;
- hosting preprocessed, non-original user-derived data becomes a supported product workflow.

If conversion is introduced, prefer KTX2 for textures, a compact typed-array binary for collision,
and GLB only for visual geometry that can round-trip the required material/MatFX metadata. The
original readers remain the validation oracle and import path.
