# Stage 6 championship foundation

Status: slice 6.5 complete on 2026-08-30: pure series rules, browser flow, results, and resilient
local persistence are connected.

## Source boundary

The extracted English message definitions confirm the original concepts `Championship`, `Tournament`,
`New Tournament`, `League Points`, qualification, Bronze/Silver/Gold cups, medals, and cup rewards.
The inspected PC PIZ does not expose a standalone Lua or text table that defines the exact cup event
order or scoring values; those may live in executable data. The clean-room runtime therefore keeps
series definitions and scoring explicit data and does not present the current alpha series as an exact
reconstruction of an original cup.

## Pure session contract

`@mashed/core` now owns `ChampionshipSession`:

- 2–4 entrants, at least two ordered events, per-event course/mode metadata, and an explicit descending
  points table;
- exact complete ranking input for each event, with unknown/duplicated/missing entrants rejected;
- `event-ready → event-complete → event-ready … → finished` transitions;
- deterministic standings ordered by points, event wins, cumulative rank, then original entrant order;
- Gold/Silver/Bronze medals assigned only when the series finishes;
- plain-data event-completed, event-advanced, and championship-completed events;
- a versioned save object containing the active event, entrant totals, and completed event results.

Restore treats local JSON as untrusted input: it verifies version/definition identity, phase/index,
event order, every complete ranking, awarded points, aggregate totals, and tie-breaker fields before
accepting state. A restored snapshot and re-exported save are identical to the original session.

## Browser runtime contract

The English roster menu exposes `Single match / Alpha Championship`. The clean-room alpha definition
uses the current loaded course (or the asset-free route) for three ordered events: Standard Play,
Hold the Flag, and The Fugitive. Championship events use a one-point match target and award
`5 / 3 / 2 / 1` series points by complete final ranking. A live HUD shows the current event and table;
results show points gained, aggregate points, and final medals. `Next event` advances without a page
reload, while `New championship` resets the completed series.

Final race order automatically closes the active match rule when a track/camera/combat terminal event
arrives, so its full ranking reaches the series even when the objective did not finish first. Manual
`Finish round` remains a development shortcut and follows the same match-completed event path.

`ChampionshipSaveStorage` stores only the versioned core save, under a definition-scoped key that also
separates course and entrant count. Access, quota, and malformed-JSON failures are contained; core
restore remains the authority that accepts or rejects the loaded value. A failed save never prevents
the in-memory series from continuing.

## Acceptance evidence

- Web typecheck and storage tests cover JSON round-trip plus unavailable/malformed storage.
- A production-shaped browser pass completed all three events, produced a `15–9` table with
  Gold/Silver medals, restored that final table after navigation, and started a fresh zero-point series.
- The complete workspace suite, build, replay matrix, soak gate, and Hard-AI lap gate remain the
  regression boundary for this slice.
