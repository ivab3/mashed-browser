import { describe, expect, it } from "vitest";

import {
  parsePowerupPlacementsLua,
  parseTrackPowerupLoadoutsLua,
} from "../src/index.js";

describe("original power-up metadata", () => {
  it("parses stateful source placements without executing Lua", () => {
    const source = `
      local GUN = 9
      local P_MINE = 12
      Set_Current_Position(1, 2.5, -3)
      Set_Current_Type(GUN)
      Set_Current_Respawn_Time(5)
      Place_Powerup()
      Set_Current_Position(-4, 0, 6)
      Set_Current_Type(P_MINE)
      Set_Current_Respawn_Time(30)
      Place_Powerup()
    `;
    expect(parsePowerupPlacementsLua(source)).toEqual([
      {
        id: "source-powerup-1",
        type: "machine-gun",
        typeId: 9,
        position: [1, 2.5, -3],
        respawnSeconds: 5,
      },
      {
        id: "source-powerup-2",
        type: "proximity-mine",
        typeId: 12,
        position: [-4, 0, 6],
        respawnSeconds: 30,
      },
    ]);
  });

  it("parses stable course loadouts and omits NONE slots", () => {
    const source = `
      local NONE = -1
      local GOLD = 3
      local NUKOV = 33
      local GUN = 9
      local FLASH = 18
      local MORTAR = 7
      Set_Track_Powerups(NUKOV, GOLD, GUN, FLASH, MORTAR, NONE)
    `;
    expect(parseTrackPowerupLoadoutsLua(source)).toEqual([{
      courseId: 33,
      tier: 3,
      powerups: ["machine-gun", "flash", "mortar"],
    }]);
  });

  it("rejects incomplete placements and unknown source ids", () => {
    expect(() => parsePowerupPlacementsLua(`
      Set_Current_Position(0, 0, 0)
      Set_Current_Type(999)
      Set_Current_Respawn_Time(5)
      Place_Powerup()
    `)).toThrow("unsupported power-up type 999");
    expect(() => parsePowerupPlacementsLua("Place_Powerup()"))
      .toThrow("requires position, type, and respawn time");
  });
});
