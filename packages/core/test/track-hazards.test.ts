import { describe, expect, it } from "vitest";
import { ALPHA_BARREL_EXPLOSION, FixedStepClock, TrackHazardSession, type TrackHazardEvent } from "../src/index.js";

const definitions = [
  { id: "a", position: [0, 0, 0] as const, ...ALPHA_BARREL_EXPLOSION },
  { id: "b", position: [3, 0, 0] as const, ...ALPHA_BARREL_EXPLOSION },
  { id: "c", position: [30, 0, 0] as const, ...ALPHA_BARREL_EXPLOSION },
];

describe("track hazard timeline", () => {
  it("warns, explodes once, chains with a full fuse and resets the round", () => {
    const session = new TrackHazardSession(definitions);
    const impact = { id: "a", position: [1, 0, 0] as const };
    expect(session.advance(0.1, {}, [impact, impact])).toEqual([
      { type: "hazard-triggered", id: "a", position: [1, 0, 0], cause: "impact" },
    ]);
    const events = session.advance(0.25, {}, [impact]);
    expect(events.map((event) => [event.type, event.id])).toEqual([
      ["hazard-exploded", "a"], ["hazard-triggered", "b"],
    ]);
    expect(session.advance(0.34)).toEqual([]);
    expect(session.advance(0.01)).toMatchObject([{ type: "hazard-exploded", id: "b" }]);
    expect(session.advance(10, {}, [impact])).toEqual([]);
    expect(session.snapshot.hazards.map((hazard) => hazard.phase)).toEqual(["spent", "spent", "armed"]);
    session.reset();
    expect(session.snapshot.elapsedSeconds).toBe(0);
    expect(session.snapshot.hazards.every((hazard) => hazard.phase === "armed")).toBe(true);
    expect(session.snapshot.hazards[0]!.position).toEqual([0, 0, 0]);
  });

  it("uses current object positions and three-dimensional blast range", () => {
    const session = new TrackHazardSession(definitions);
    const events = session.advance(0.35, { b: [0, 10, 0], c: [1, 0, 0] }, [{ id: "a", position: [0, 0, 0] }]);
    expect(events.filter((event) => event.type === "hazard-triggered").map((event) => event.id)).toEqual(["a", "c"]);
  });

  it("rejects invalid data atomically and does not retain caller-owned positions", () => {
    expect(() => new TrackHazardSession([definitions[0]!, definitions[0]!])).toThrow("unique");
    for (const field of ["fuseSeconds", "radiusMeters", "damage", "knockbackImpulse"] as const) {
      expect(() => new TrackHazardSession([{ ...definitions[0]!, [field]: Number.NaN }])).toThrow("positive");
    }
    const session = new TrackHazardSession(definitions);
    const before = session.snapshot;
    expect(() => session.advance(-1)).toThrow();
    expect(() => session.advance(1, {}, [{ id: "unknown", position: [0, 0, 0] }])).toThrow("Unknown");
    expect(() => session.advance(1, { a: [Number.NaN, 0, 0] })).toThrow("finite");
    expect(session.snapshot).toEqual(before);
    const view = session.snapshot;
    (view.hazards[0]!.position as unknown as number[])[0] = 100;
    expect(session.snapshot.hazards[0]!.position[0]).toBe(0);
  });

  it("replays impacts and delayed chains identically on 30/60/120 Hz clocks", () => {
    const replay = (hz: number) => {
      const session = new TrackHazardSession([...definitions].reverse());
      const clock = new FixedStepClock({ stepSeconds: 1 / 60 });
      const events: TrackHazardEvent[] = [];
      let step = 0;
      const simulate = (dt: number) => {
        events.push(...session.advance(dt, {}, step++ === 5 ? [{ id: "a", position: [0, 0, 0] }] : []));
      };
      clock.advance(0, simulate);
      for (let frame = 1; frame <= hz * 2; frame += 1) clock.advance(frame / hz, simulate);
      return { step, events, snapshot: session.snapshot };
    };
    expect(replay(30)).toEqual(replay(60));
    expect(replay(120)).toEqual(replay(60));
    expect(replay(60).events.filter((event) => event.type === "hazard-exploded")).toHaveLength(2);
  });
});
