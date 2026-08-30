import { describe, expect, it } from "vitest";

import { parseCourseLua } from "@mashed/assets";

import { declaredTrackBsps, trackBspRole } from "../src/track-resource-role.js";

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
});
