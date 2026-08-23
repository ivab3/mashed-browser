# Stage 3 runtime foundation

Date: 2026-08-23
Status: complete

This document fixes the runtime contracts that Stage 4 vehicle work must preserve. The browser
shell is deliberately a physics proxy rather than a vehicle implementation: its job is to prove
timing, state, event, loading, rendering, audio, and debug boundaries before handling is tuned.

## Package boundaries

```text
@mashed/replay ──> @mashed/core <── apps/web
                         ▲              │
                         │              ├──> @mashed/audio
                         ├──────────────┼──> @mashed/physics ──> Rapier WASM
                         │              └──> @mashed/renderer ──> Three.js
                         │
@mashed/assets <── loading Worker ── transferable DTOs ──> apps/web cache
```

- `@mashed/core` uses only ES2022 APIs. It has no DOM, Three.js, Web Audio, or Rapier dependency.
- `@mashed/physics` owns the Rapier world and rejects a timestep other than the configured fixed
  step. The official `@dimforge/rapier3d-compat` build is used so Vite and Vitest share the same
  inlined-WASM initialization path.
- `@mashed/renderer` consumes previous/current physics transforms and the clock alpha; it never
  advances simulation.
- `@mashed/audio` consumes plain-data events and unlocks `AudioContext` only after a user gesture.
- `apps/web` composes adapters and owns browser lifecycle only.

## Clock contract

`FixedStepClock` accepts presentation timestamps in seconds and emits stable `1/60` ticks. The
defaults are:

| Parameter | Value | Purpose |
| --- | ---: | --- |
| simulation step | 16.6667 ms | one gameplay/physics frame |
| maximum presented frame | 250 ms | prevents a multi-second focus pause entering the accumulator |
| maximum catch-up | 8 steps | bounds CPU work after a long frame |

If more than eight steps are due, whole excess steps are discarded and reported as a
`simulation:overrun` event. The fractional remainder is preserved for interpolation. `blur`,
`focus`, and `visibilitychange` reset the presentation anchor and accumulator, so returning to the
tab never tries to simulate the hidden interval.

The browser calls the clock only in `race`. `menu`, `loading`, and `results` keep rendering but do
not advance gameplay. Starting or restarting a race resets the step index and dropped-time counter.

## State and events

The state machine validates transitions around the primary flow:

```text
boot → loading → menu → race → results
                   ↑       │       │
                   └───────┴───────┘
```

Menu/results may enter loading for local asset parsing and return to menu. Invalid transitions
throw synchronously rather than producing a partially initialized runtime.

`RuntimeEventBus` carries discriminated, structured-clone-compatible records for state changes,
focus, overruns, physics contacts, audio cues, and renderer flashes. This keeps Worker migration and
replay/event recording possible without exposing adapter objects to core.

## Replay and random contract

`ReplayTape` stores `version`, `seed`, fixed `stepSeconds`, and one input value per simulation frame.
`SeededRandom` uses serializable xorshift32 state; save/restore reproduces the following sequence.

The acceptance test plays the same 360-frame tape through presentation clocks at 30, 60, and
120 Hz. All three runs finish with the exact same step count, position, velocity, heading, and RNG
state. This verifies independence from render cadence on one platform. Cross-browser Rapier replay
validation remains part of the vehicle milestone once vehicle inputs and a representative collision
scene exist.

## Loading Worker boundary

The Worker accepts an `ArrayBuffer` plus an explicit `dff`, `txd`, or `bsp` kind. It calls the same
`@mashed/assets` readers as the CLI/viewer, recursively finds parsed typed-array backing buffers,
deduplicates them, and transfers ownership to the main thread. Responses report parsing time and
transferred byte count. Loaded DTOs currently stay in an in-memory map; renderer/physics consumers
will bind the selected race working set during Stage 4/5.

Original files are selected through the browser and are not copied to source or production output.

## Debug runtime

The overlay reports FPS, render frame time, accumulated physics time for the presentation frame,
Three.js draw calls, rigid bodies/colliders, active contact pairs, simulation step, and discarded
catch-up time. The viewport has an optional orbit camera and converts `world.debugRender()` buffers
to colored Three.js line segments.

## Acceptance evidence

Automated verification:

```bash
pnpm typecheck
pnpm test
pnpm build
```

- Core: 10 tests for clock cadence/overrun/focus reset, transitions/events, RNG, and transforms.
- Replay: identical final state at synthetic 30/60/120 Hz presentation rates.
- Physics: repeated Rapier worlds match locally; a variable timestep is rejected.
- Web: nested typed-array buffers are discovered once even when views share storage or DTOs cycle.
- Existing extractor/assets suites remain green.
- Vite production builds emit the UI, loading Worker, and separately loaded Rapier chunk.

In-app browser smoke on the development build confirmed:

- Rapier WASM and WebGL initialize into `menu`;
- `menu → race → results` changes control availability correctly;
- the simulation step advances only in `race` and remains frozen in `results`;
- enabling collider lines increases the draw-call count and a ground contact appears in telemetry;
- no console errors or warnings occur during the flow.

## Commands

```bash
pnpm web
pnpm --filter @mashed/web build
pnpm --filter @mashed/core test
pnpm --filter @mashed/replay test
pnpm --filter @mashed/physics test
```
