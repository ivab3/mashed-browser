import { describe, expect, it } from "vitest";

import { fitSharedCamera } from "../src/camera-fit.js";

describe("shared multiplayer camera fit", () => {
  it("preserves the accepted single-vehicle chase framing", () => {
    expect(fitSharedCamera([{ position: [-4, 0.5, -8] }])).toEqual({
      center: [-4, 0.5, -8],
      radiusMeters: 0,
      trailMeters: 10,
      heightMeters: 7.2,
      lookAheadMeters: 3,
    });
  });

  it("centers a side-by-side grid and pulls back as vehicles separate", () => {
    const startingGrid = fitSharedCamera([
      { position: [-4, 0.5, -8] },
      { position: [-6, 0.5, -8] },
    ]);
    const separated = fitSharedCamera([
      { position: [-4, 0.5, -3] },
      { position: [-6, 0.5, -13] },
    ]);

    expect(startingGrid.center).toEqual([-5, 0.5, -8]);
    expect(startingGrid.radiusMeters).toBe(1);
    expect(startingGrid.trailMeters).toBeCloseTo(11.15);
    expect(startingGrid.heightMeters).toBeCloseTo(8.15);
    expect(separated.center).toEqual([-5, 0.5, -8]);
    expect(separated.radiusMeters).toBeCloseTo(Math.hypot(1, 5));
    expect(separated.trailMeters).toBeGreaterThan(startingGrid.trailMeters);
    expect(separated.heightMeters).toBeGreaterThan(startingGrid.heightMeters);
    expect(separated.lookAheadMeters).toBeLessThan(startingGrid.lookAheadMeters);
  });

  it("caps zoom growth for extreme separation and rejects invalid subjects", () => {
    const extreme = fitSharedCamera([
      { position: [-40, 0, 0] },
      { position: [40, 0, 0] },
    ]);
    expect(extreme.radiusMeters).toBe(40);
    expect(extreme.trailMeters).toBe(33);
    expect(extreme.heightMeters).toBe(26.2);
    expect(extreme.lookAheadMeters).toBe(0.75);
    expect(() => fitSharedCamera([])).toThrow(/at least one subject/);
    expect(() => fitSharedCamera([{ position: [Number.NaN, 0, 0] }])).toThrow(/finite/);
  });
});
