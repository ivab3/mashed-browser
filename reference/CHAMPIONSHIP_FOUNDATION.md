# Stage 6 championship foundation

Status: pure series-rules slice 6.5a complete on 2026-08-30. Browser menu/results integration is the
next half of the slice.

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

## Next runtime slice

Slice 6.5b should expose an English `Single match / Championship` menu choice, an explicit alpha cup
definition, event briefing and series standings, automatic transfer of final match ranking into the
series, next-event flow, and local persistence through a small storage adapter. Storage failures must
leave the in-memory championship playable.
