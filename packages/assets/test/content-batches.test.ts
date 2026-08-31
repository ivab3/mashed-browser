import { describe, expect, it } from "vitest";

import {
  ALPHA_CONTENT_BATCHES,
  admittedTrackByCourseId,
  admittedVehicleByAssetName,
  alphaContentBatch,
} from "../src/index.js";

describe("Stage 6 content admissions", () => {
  it("keeps batch, track, course, and vehicle identities unique", () => {
    const batchIds = ALPHA_CONTENT_BATCHES.map((batch) => batch.id);
    const tracks = ALPHA_CONTENT_BATCHES.flatMap((batch) => batch.tracks);
    const vehicles = ALPHA_CONTENT_BATCHES.flatMap((batch) => batch.vehicles);
    expect(new Set(batchIds).size).toBe(batchIds.length);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(tracks.length);
    expect(new Set(tracks.map((track) => track.courseId)).size).toBe(tracks.length);
    expect(new Set(vehicles.map((vehicle) => vehicle.id)).size).toBe(vehicles.length);
    expect(new Set(vehicles.map((vehicle) => vehicle.assetBaseName)).size).toBe(vehicles.length);
  });

  it("resolves the admitted City and Wildfire records without guessing case", () => {
    expect(alphaContentBatch("6.6a-city-wildfire")?.status).toBe("admitted");
    expect(admittedTrackByCourseId(26)).toMatchObject({ id: "city-26", displayName: "City" });
    expect(admittedVehicleByAssetName("wildfire")).toMatchObject({
      id: "wildfire",
      nameMapping: "exact-name",
      variants: [0, 1, 2, 3, 4, 5],
    });
    expect(admittedTrackByCourseId(39)).toMatchObject({
      id: "neustein-39",
      powerupLoadoutPath: "Common/POWERUPS/Powerups/POWERUPS_ALL.LUA",
    });
    expect(admittedVehicleByAssetName("crusader")).toMatchObject({
      displayName: "Bahnstormer",
      nameMapping: "inferred-position",
    });
    expect(admittedTrackByCourseId(0)).toMatchObject({
      id: "arctic-0",
      powerupFileName: "POWERUPS_GOLD.LUA",
    });
    expect(admittedVehicleByAssetName("shorty")).toMatchObject({
      displayName: "Ruckus",
      nameMapping: "inferred-position",
      variants: [0, 1, 2, 3, 4, 5],
    });
    expect(admittedTrackByCourseId(33)).toMatchObject({
      id: "warzone-33",
      powerupLoadoutPath: "Common/POWERUPS/Powerups/POWERUPS_ALL.LUA",
    });
  });

  it("records every deferred City source family explicitly", () => {
    const boundaries = admittedTrackByCourseId(26)?.resourceBoundaries ?? [];
    const deferred = boundaries.filter((boundary) => boundary.disposition === "deferred")
      .map((boundary) => boundary.suffix);
    expect(deferred).toEqual(expect.arrayContaining([
      ".aid",
      ".anm",
      ".uva",
      "ktcscript.lua",
      "powerups_gold.dff",
    ]));
    expect(boundaries.find((boundary) => boundary.suffix === ".mts")?.disposition).toBe("parsed-only");
  });

  it("admits the complete 15-vehicle numbered-skin roster without promoting inferred names", () => {
    const vehicles = ALPHA_CONTENT_BATCHES.flatMap((batch) => batch.vehicles);
    expect(vehicles).toHaveLength(15);
    expect(vehicles.every((vehicle) => (
      vehicle.variants.join(",") === "0,1,2,3,4,5"
    ))).toBe(true);
    expect(vehicles.filter((vehicle) => vehicle.nameMapping === "exact-name").map((vehicle) => (
      vehicle.assetBaseName
    ))).toEqual(["WILDFIRE"]);
    expect(admittedVehicleByAssetName("advantage")).toMatchObject({
      displayName: "Shuriken",
      directoryName: "Advantag",
    });
    expect(admittedVehicleByAssetName("bigboss")?.resourceBoundaries.flatMap((boundary) => (
      boundary.fileNames
    ))).not.toContain("BIGBOSSARMS.DFF");
  });
});
