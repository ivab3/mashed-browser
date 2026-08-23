import { describe, expect, it } from "vitest";

import { parseVehicleDffName, selectVehicleAssetPair } from "../src/index.js";

describe("Mashed vehicle asset naming", () => {
  it("recognizes numbered DFF skins and derives their shared TXD", () => {
    expect(parseVehicleDffName("CRUSADER4.DFF")).toEqual({
      fileName: "CRUSADER4.DFF",
      vehicleName: "CRUSADER",
      variant: 4,
      textureDictionaryFileName: "CRUSADER.txd",
    });
    expect(parseVehicleDffName("CRUSADERLIGHTS.DFF")).toBeUndefined();
  });

  it("matches names case-insensitively and prefers variant zero", () => {
    expect(selectVehicleAssetPair(
      ["CRUSADER4.DFF", "fade_3.dff", "crusader0.dff"],
      ["Warzone.txd", "CRUSADER.TXD"],
    )).toMatchObject({
      fileName: "crusader0.dff",
      variant: 0,
      textureFileName: "CRUSADER.TXD",
    });
  });
});
