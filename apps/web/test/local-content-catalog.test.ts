import { describe, expect, it } from "vitest";

import { LOCAL_TRACK_SOURCES, LOCAL_VEHICLE_SOURCES } from "../src/local-content-catalog.js";

describe("local content catalog", () => {
  it("exposes every admitted Stage 6 track with a distinct preview", () => {
    expect(LOCAL_TRACK_SOURCES.map((track) => track.courseId)).toEqual([26, 39, 0, 33]);
    expect(new Set(LOCAL_TRACK_SOURCES.map((track) => track.id)).size).toBe(4);
    expect(new Set(LOCAL_TRACK_SOURCES.map((track) => track.previewTextureName)).size).toBe(4);
  });

  it("exposes the complete 15-car roster and all six paints", () => {
    expect(LOCAL_VEHICLE_SOURCES).toHaveLength(15);
    expect(new Set(LOCAL_VEHICLE_SOURCES.map((vehicle) => vehicle.assetBaseName)).size).toBe(15);
    expect(new Set(LOCAL_VEHICLE_SOURCES.map((vehicle) => vehicle.previewTextureName)).size).toBe(15);
    expect(LOCAL_VEHICLE_SOURCES.every((vehicle) => (
      JSON.stringify(vehicle.variants) === JSON.stringify([0, 1, 2, 3, 4, 5])
    ))).toBe(true);
  });
});
