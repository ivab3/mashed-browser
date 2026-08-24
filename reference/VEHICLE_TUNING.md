# Stage 4 vehicle feel tuning

Status: the comparison loop is ready. The source-derived throttle build-up curve and `1000` chassis
mass are accepted; the remaining raw steering/grip values still need a cross-engine mapping before
they can be applied to Rapier.

## Purpose

Vehicle feel is accepted by a human A/B drive in the reference game and the browser runtime. The
headless suite does not decide what feels correct; it makes each browser-side change measurable and
guards an accepted tune from accidental drift.

The canonical first comparison uses the European Fully Loaded reference build documented in
[`REFERENCE.md`](../REFERENCE.md), the Crusader, keyboard input, and an asphalt section of Warzone.
If a different car, track, surface, or input device is used, it must be recorded with the result.

## Reproducible browser scenarios

`pnpm vehicle:tune` runs six fixed 60 Hz input tapes:

| Scenario | Input tape | Main observations |
|---|---|---|
| Acceleration | four seconds of full throttle | 0–50 km/h time, distance, exit speed |
| Braking | three seconds of throttle, then full service brake | stopping time and distance |
| Slalom | six seconds, alternating 52% steering every 0.75 s | lateral response and speed |
| Drift | two seconds of throttle, then a 1.5 s turn with and without handbrake | rotation, slip and speed loss |
| Cornering | two seconds of throttle, then three seconds at 82% steering | body tilt, wheel lift and stability |
| Impact | full throttle into the first light crate, then 0.5 s neutral | impact force and retained speed |

The suite reports schema version 2. The committed browser regression baseline is
[`vehicle-tuning-baseline.json`](./vehicle-tuning-baseline.json).

## Candidate comparison

Run the committed profile against its baseline:

```bash
pnpm vehicle:tune -- --compare reference/vehicle-tuning-baseline.json
```

The comparison contains the number of common metrics and only non-zero deltas. An alternative
data-driven profile can live in the ignored `reference/captures/` directory and be evaluated without
editing the committed tune:

```bash
pnpm vehicle:tune -- \
  --config reference/captures/crusader-candidate.json \
  --compare reference/vehicle-tuning-baseline.json
```

Change one parameter family at a time: drive/brake, steering/grip, suspension/stability, then
impact response. After a candidate wins the human A/B check, copy its values into
`packages/physics/data/arcade-default.json`, update the regression baseline, and run both
`pnpm test` and `pnpm lap:validate`.

## Reference-game capture

Use `tools/reference/run-crossover.sh` for the original. A capture note belongs under the ignored
`reference/captures/` directory and records:

- date, reference build, vehicle, track, surface, input device, and game mode;
- which of the six scenarios was repeated;
- a short directional verdict such as `browser accelerates too slowly`, `handbrake rotates too
  abruptly`, or `body is too rigid over the same corner`;
- an optional timestamped clip or numeric measurement only when it helps decide a concrete change;
- the candidate config id and the tuning comparison output used for the browser half.

No original-game target is inferred from the current browser numbers. A target is promoted into the
repository only after a repeatable reference-game observation exists.

## Original executable audit

The editable PIZ data does not contain a named acceleration or engine-force profile. The relevant
vehicle update is compiled into `game-data/files/MFL.exe`. Its two signed drive channels use an
independent hold timer and the same normalized envelope. Before that envelope, the byte input is
scaled by `1/256` and a compiled channel gain of `34`:

```text
0.5 * (6000 ms + min(held ms, 6000 ms)) / 6000 ms
```

That is 50% drive force at the start of a press, followed by a linear rise to 100% over six seconds.
Releasing the channel resets its timer; forward and reverse have separate timers. The default
browser profile now applies this exact normalized curve to its Rapier engine/reverse forces. The
browser full-force value was recalibrated to `8000`. With the subsequently accepted source chassis
mass of `1000`, the deterministic 0–50 result is `3.267 s`; this is a browser-side calibration, not
a claim that `8000` occurs in the original executable.

Two conditional executable paths add `0.75` and `1.5` multipliers. They are tied to special vehicle
state flags, so neither is treated as the normal acceleration profile.

The executable also contains a 15-entry per-vehicle tuning table. Its vehicle-selection UI confirms
the field order as `Power / Grip / Handling / Drag`. Crusader (internal id `48`) has the raw row
`85, 35000, 900, 1600`; the latter two values become `0.9` and `1.6` in physics state. Those units do
not map directly to Rapier wheel force, so the next candidate translates the original speed-sensitive
steering relationship instead of copying the raw numbers into unrelated Rapier coefficients.

The vehicle constructor independently hardcodes chassis mass `1000` and inverse mass `0.001`. A
single-variable browser candidate using that mass won the human A/B drive on Crusader/Warzone and is
now the accepted default. It changed no chassis dimensions or other handling parameters.
