import { describe, expect, it } from "vitest";

import { parseCourseLua } from "../src/index.js";

const FIXTURE = `
  -- declarative registry
  Course_Id(33)
  Texture_Dictionary_Filename("Warzone.txd")
  World_Bsp_Filename("Graphics.bsp")
  AI_Bsp_Filename("Ai1.bsp")
  Collision_Bsp_Filename("Collide.bsp")
  Lights_Filename("Lights.dff")
  Sky_Filename(1, "HorDome.dff")
  Sky_Filename(0, "SkyDome.dff")
  local FADE = 24
  Clump_Filename(FADE, "fade_3.dff")
  ClumpFade(FADE, 0, 135, 1.0)
  Clump_Exclude_From_World(FADE)
  RWP_Object(21, "POST", "Post_A.dff", "Post_A.mts")
  -- Clump_Filename(99, "disabled.dff")
`;

describe("COURSE.LUA metadata", () => {
  it("resolves numeric aliases and extracts asset registries without executing Lua", () => {
    expect(parseCourseLua(FIXTURE)).toEqual({
      id: 33,
      textureDictionaryFileName: "Warzone.txd",
      worldBspFileName: "Graphics.bsp",
      aiBspFileName: "Ai1.bsp",
      collisionBspFileName: "Collide.bsp",
      lightsFileName: "Lights.dff",
      skies: [
        { index: 0, fileName: "SkyDome.dff" },
        { index: 1, fileName: "HorDome.dff" },
      ],
      clumps: [{
        index: 24,
        fileName: "fade_3.dff",
        excludedFromWorld: true,
        fade: { checkpointStart: 0, checkpointEnd: 135, distance: 1 },
      }],
      objectTemplates: [{
        index: 21,
        displayName: "POST",
        dffFileName: "Post_A.dff",
        mtsFileName: "Post_A.mts",
      }],
      instanceFiles: [],
      explosiveObjects: [],
    });
  });

  it("rejects unknown values in relevant calls", () => {
    expect(() => parseCourseLua("Course_Id(ID_FROM_CODE)"))
      .toThrow("unsupported value ID_FROM_CODE");
  });

  it("resolves explosive instance declarations and preserves optional profile identities", () => {
    const source = `Course_Id(1)
      local BARREL = 3
      ExpObj_Clump_Mts_Pair(BARREL, 4, 0)
      Clump_Filename(BARREL, "barrel.dff")
      Mts_Filename(4, "barrel.mts")`;
    expect(parseCourseLua(source)).toMatchObject({
      instanceFiles: [{ index: 4, fileName: "barrel.mts" }],
      explosiveObjects: [{ clumpIndex: 3, mtsIndex: 4, explosionProfileIndex: 0 }],
    });
    expect(parseCourseLua(source.replace(", 4, 0)", ", 4)" )).explosiveObjects[0])
      .toEqual({ clumpIndex: 3, mtsIndex: 4 });
    expect(() => parseCourseLua(source.replace('Mts_Filename(4, "barrel.mts")', "")))
      .toThrow("unresolved");
    expect(() => parseCourseLua(`${source}\nExpObj_Clump_Mts_Pair(3, 4)`)).toThrow("duplicated");
    expect(() => parseCourseLua(`${source}\nMts_Filename(4, "other.mts")`)).toThrow("more than once");
  });
});
