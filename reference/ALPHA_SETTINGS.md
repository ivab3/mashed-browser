# Stage 6 alpha settings

Status: slice 6.7a accepted on 2026-08-30.

The production browser menu exposes four runtime-backed setting groups:

| Setting | Runtime effect |
|---|---|
| CPU preset | Easy/Normal/Hard is applied to every currently selected CPU driver while human slots remain unchanged |
| Gamepad deadzone | Rebuilds each browser input adapter with a normalized deadzone from 0 to 0.5 |
| Master volume / mute | Scales synthesized cues, original RWS samples, and active engine voices through the Web Audio adapter |
| Graphics quality | Performance caps device pixel ratio at 1 and disables shadows; Balanced caps at 1.5; Quality caps at 2 |

Difficulty and deadzone changes are disabled during an active match because they alter deterministic
gameplay input. Audio mute/volume and graphics quality remain live. Reset restores the explicit alpha
defaults: Normal CPU preset, 12% deadzone, 70% volume, audio enabled, and Quality graphics.

## Persistence contract

`AlphaSettingsStorage` writes one source-independent JSON record under
`mashed-browser:settings:v1`. The record includes an exact `version: 1` discriminator. Restore
strictly validates the object shape, enum values, booleans, finite numeric values, deadzone range
`[0, 0.5]`, and volume range `[0, 1]`; parsed JSON is never trusted as a TypeScript value. Missing
storage selects defaults. Malformed JSON, unsupported versions, invalid values, and unavailable
browser storage are contained and reported without blocking boot.

Championship progress retains its separate definition-scoped versioned keys. Settings reset does not
erase championship saves.

## Acceptance evidence

Unit coverage round-trips a custom record and rejects unknown versions, invalid enum members,
out-of-range values, malformed JSON, and unavailable storage. Audio coverage checks safe master-gain
normalization before an `AudioContext` is unlocked.

The production browser acceptance changed all four categories (`Hard`, `Performance`, 35% volume,
24% deadzone, muted), confirmed that the CPU preset changed an active Easy CPU to Hard, navigated to a
fresh page, and restored every value. Reset restored all defaults, a second reload restored that reset,
and a two-player/one-CPU match reached results with gameplay-sensitive settings locked during the
round. A targeted muted start also advanced 255 fixed steps through the race-start cue path without
an audio error. Both reload paths and both match paths completed with no console warnings or errors.

Run the committed gates with:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Keyboard rebinding and the final M2 compatibility report remain follow-up work; they are not claimed
by this slice.
