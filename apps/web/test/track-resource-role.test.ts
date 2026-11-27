import { describe, expect, it } from "vitest";

import { parseCourseLua } from "@mashed/assets";

import { declaredTrackBsps, playableTrackFiles, trackBspRole } from "../src/track-resource-role.js";

describe("track BSP roles", () => {
  it("uses non-standard filenames declared by COURSE.LUA", () => {
    const course = parseCourseLua(`
      Course_Id(0)
      AI_Bsp_Filename("ai.bsp")
      Collision_Bsp_Filename("collisions.bsp")
      World_Bsp_Filename("graph.bsp")
      Texture_Dictionary_Filename("textures.txd")
    `);

    expect(declaredTrackBsps(course)).toEqual([
      { role: "ai", fileName: "ai.bsp" },
      { role: "collision", fileName: "collisions.bsp" },
      { role: "graphics", fileName: "graph.bsp" },
    ]);
    expect(trackBspRole("GRAPH.BSP", course)).toBe("graphics");
    expect(trackBspRole("AI.BSP", course)).toBe("ai");
  });

  it("keeps conventional filename fallback for bundles without COURSE.LUA", () => {
    expect(trackBspRole("AI1.BSP")).toBe("ai");
    expect(trackBspRole("COLLIDE.BSP")).toBe("collision");
    expect(trackBspRole("GRAPHICS.BSP")).toBe("graphics");
    expect(trackBspRole("GRAPH.BSP")).toBeUndefined();
  });

  it("selects course models and hazard instances from a version 1 catalog with an embedded bank reference", () => {
    const course = parseCourseLua(`
      Course_Id(0)
      World_Bsp_Filename("graph.bsp")
      Texture_Dictionary_Filename("winter.txd")
      Lights_Filename("Lights.dff")
      Sky_Filename(0, "Sky.dff")
      Clump_Filename(1, "RBarrel.dff")
      Mts_Filename(2, "barrels.mts")
      ExpObj_Clump_Mts_Pair(1, 2)
    `);
    const used = ["GRAPH.BSP", "WINTER.TXD", "SKY.DFF", "LIGHTS.DFF", "RBARREL.DFF", "BARRELS.MTS",
      "LAPDATA.LUA", "POWERUPS_GOLD.LUA", "POWERUPS_ALL.LUA", "AI0.AI", "LE0.LED"];
    const names = [...used, "EXTRA.TXD", "WORLD.BSP", "OTHER.DFF", "DECOR.MTS", "COURSE.LUA", "KTCSCRIPT.LUA", "PERMDICT.RWS"];
    const files = names.map((name) => ({ name, url: `cache:${name.toLowerCase()}` }));
    expect(playableTrackFiles(files, course).map(({ name }) => name)).toEqual(used);
  });
});
