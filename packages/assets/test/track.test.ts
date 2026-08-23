import { describe, expect, it } from "vitest";

import {
  deriveTrackDefinition,
  parseLapDataLua,
  type BspWorld,
  type BspWorldSector,
} from "../src/index.js";

const LAP_DATA = `
  Lap_Variations(1)
  Lap_Line(0)
  Lap_Line(2)
  Lap_Line_End()
  Safe_Start_Lines(0, 1)
  Split_Sector(0, 1)
`;

function aiWorld(): BspWorld {
  const positions: number[] = [];
  const indices: number[] = [];
  const materials: number[] = [];
  for (let checkpoint = 0; checkpoint < 3; checkpoint += 1) {
    const start = positions.length / 3;
    const centerX = 4 - checkpoint * 2;
    positions.push(
      centerX - 0.5, checkpoint, -1,
      centerX + 0.5, checkpoint, -1,
      centerX + 0.5, checkpoint, 1,
      centerX - 0.5, checkpoint, 1,
    );
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    materials.push(checkpoint, checkpoint);
  }
  const sector = {
    kind: "world",
    index: 0,
    triangleCount: 6,
    vertexCount: 12,
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    triangleMaterialIndices: new Uint16Array(materials),
  } as BspWorldSector;
  return { worldSectors: [sector] } as BspWorld;
}

describe("track metadata", () => {
  it("parses original LAPDATA calls without evaluating Lua", () => {
    expect(parseLapDataLua(LAP_DATA)).toEqual({
      variations: 1,
      line: [0, 2],
      safeStartRanges: [[0, 1]],
      splitCheckpointIds: [1],
    });
  });

  it("turns AI BSP material polygons into an ordered course and spawn", () => {
    const track = deriveTrackDefinition(aiWorld(), parseLapDataLua(LAP_DATA));
    expect(track.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([0, 1, 2]);
    expect(track.checkpoints.map((checkpoint) => checkpoint.center)).toEqual([
      [4, 0, 0],
      [2, 1, 0],
      [0, 2, 0],
    ]);
    expect(track.spawn.position).toEqual([4, 1.05, 0]);
    expect(track.spawn.headingRadians).toBeCloseTo(-Math.PI / 2);
  });

  it("rejects a drive line that references a missing AI material", () => {
    const data = parseLapDataLua(LAP_DATA);
    expect(() => deriveTrackDefinition({ worldSectors: [] } as unknown as BspWorld, data))
      .toThrow("material 0");
  });
});
