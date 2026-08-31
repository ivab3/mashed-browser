# Stage 6 alpha settings

Status: slice 6.7a accepted on 2026-08-30; P1 rebinding slice 6.7b accepted on 2026-08-31.

The production browser menu exposes runtime-backed settings:

| Setting | Runtime effect |
|---|---|
| CPU preset | Easy/Normal/Hard is applied to every currently selected CPU driver while human slots remain unchanged |
| Gamepad deadzone | Rebuilds each browser input adapter with a normalized deadzone from 0 to 0.5 |
| P1 keyboard bindings | Rebinds eight actions through the production keyboard adapter and updates the driving guide |
| Master volume / mute | Scales synthesized cues, original RWS samples, and active engine voices through the Web Audio adapter |
| Graphics quality | Performance caps device pixel ratio at 1 and disables shadows; Balanced caps at 1.5; Quality caps at 2 |

Difficulty and deadzone changes are disabled during an active match because they alter deterministic
gameplay input. Audio mute/volume and graphics quality remain live. Reset restores the explicit alpha
defaults: Normal CPU preset, 12% deadzone, 70% volume, audio enabled, Quality graphics, and the
W/S/A/D + Left Shift/Space/R/E P1 layout.

## Keyboard capture and conflict rules

Expand **P1 keyboard bindings**, choose an action, and press a key. Assigning a key already used by
another P1 action swaps the two actions, preserving one unique key per action. Escape cancels capture.
P2's arrow/action keys and global runtime/browser keys are reserved; restore and capture both accept
only an explicit set of supported letter, number, punctuation, modifier, and numpad codes.

Single-player keeps its existing arrows/brake/item fallbacks alongside the custom P1 layout. P2's
multiplayer layout remains fixed and independent. Rebinding controls lock during a match, and entering
loading/race/paused cancels any pending capture. Focused form controls, buttons, summaries, links, and
editable text do not feed gameplay keys. Starting or resuming a race returns focus to the viewport.

## Persistence contract

`AlphaSettingsStorage` writes one source-independent JSON record under
`mashed-browser:settings:v1`. The record includes an exact `version: 1` discriminator. Restore
strictly validates the object shape, enum values, booleans, finite numeric values, deadzone range
`[0, 0.5]`, and volume range `[0, 1]`; parsed JSON is never trusted as a TypeScript value. Missing
storage selects defaults. Malformed JSON, unsupported versions, invalid values, and unavailable
browser storage are contained and reported without blocking boot.

`ControlBindingsStorage` independently stores `{ version: 1, playerOne: ... }` under
`mashed-browser:bindings:v1`, preserving compatibility with existing alpha-settings saves. Restore
rejects unknown fields/actions, missing actions, duplicate keys, unsupported/reserved codes, and
unsupported versions. A failed restore selects the default P1 layout; a failed write leaves the new
in-memory layout playable and reports the failure. Settings Reset saves both default records.

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

The 6.7b browser pass captured Accelerate = I, then assigned I to Reverse and verified the conflict
swap (Accelerate = S, Reverse = I). ArrowUp was rejected without changing steer-left, and Escape
cancelled capture. A fresh page restored the swapped layout and matching guide. Starting a match
cancelled an unfinished capture and disabled all eight binding buttons; the ordinary finish path
reached results. Reset plus reload restored the original layout. Console warnings/errors were absent.
This is a UI/input-contract smoke, not a new frame-time benchmark.

Production-adapter unit coverage independently verifies that the old W key stops accelerating after
rebinding to I, the new I key drives forward, keyup releases it, and S still reverses. Input tests also
verify that focused UI keys neither prevent native behavior nor latch gameplay actions.

Run the committed gates with:

```bash
pnpm test
pnpm typecheck
pnpm build
```

P2 remapping, configurable gamepad button mapping, and the final M2 compatibility report remain
follow-up work; they are not claimed by these slices.
