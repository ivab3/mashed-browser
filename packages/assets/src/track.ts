import type { BspWorld } from "./renderware/bsp.js";

export type TrackVector3 = readonly [number, number, number];
export type TrackTriangle = readonly [TrackVector3, TrackVector3, TrackVector3];

export interface LapDataDefinition {
  variations: number;
  line: readonly number[];
  safeStartRanges: ReadonlyArray<readonly [number, number]>;
  splitCheckpointIds: readonly number[];
}

export interface DerivedTrackCheckpoint {
  id: number;
  center: TrackVector3;
  triangles: readonly TrackTriangle[];
}

export interface DerivedTrackDefinition {
  checkpoints: readonly DerivedTrackCheckpoint[];
  splitCheckpointIds: readonly number[];
  safeStartRanges: ReadonlyArray<readonly [number, number]>;
  spawn: {
    position: TrackVector3;
    headingRadians: number;
  };
}

function requiredInteger(source: string, name: string): number {
  const match = source.match(new RegExp(`${name}\\s*\\(\\s*(\\d+)\\s*\\)`, "i"));
  if (!match?.[1]) {
    throw new Error(`LAPDATA is missing ${name}`);
  }
  return Number(match[1]);
}

function integerArguments(source: string, name: string): number[][] {
  const matches = source.matchAll(new RegExp(`${name}\\s*\\(([^)]*)\\)`, "gi"));
  return [...matches].map((match) => {
    const values = (match[1] ?? "").split(",").map((value) => Number(value.trim()));
    if (values.length === 0 || values.some((value) => !Number.isInteger(value))) {
      throw new Error(`LAPDATA has invalid arguments for ${name}`);
    }
    return values;
  });
}

/** Parses the declarative calls used by the original LAPDATA.LUA without executing Lua. */
export function parseLapDataLua(source: string): LapDataDefinition {
  const line = integerArguments(source, "Lap_Line").map((values) => values[0]!);
  if (line.length < 2 || !/Lap_Line_End\s*\(\s*\)/i.test(source)) {
    throw new Error("LAPDATA needs at least two Lap_Line calls followed by Lap_Line_End()");
  }
  const safeStartRanges = integerArguments(source, "Safe_Start_Lines").map((values) => {
    if (values.length !== 2) {
      throw new Error("Safe_Start_Lines expects two checkpoint ids");
    }
    return [values[0]!, values[1]!] as const;
  });
  const splitCheckpointIds = integerArguments(source, "Split_Sector").map((values) => {
    if (values.length !== 2) {
      throw new Error("Split_Sector expects a sector and checkpoint id");
    }
    return values[1]!;
  });
  return {
    variations: requiredInteger(source, "Lap_Variations"),
    line,
    safeStartRanges,
    splitCheckpointIds,
  };
}

function vertex(positions: Float32Array, index: number): TrackVector3 {
  const offset = index * 3;
  return [positions[offset]!, positions[offset + 1]!, positions[offset + 2]!];
}

function checkpointCenter(triangles: readonly TrackTriangle[]): TrackVector3 {
  const unique = new Map<string, TrackVector3>();
  for (const triangle of triangles) {
    for (const point of triangle) {
      unique.set(`${point[0]}:${point[1]}:${point[2]}`, point);
    }
  }
  const points = [...unique.values()];
  const totals = points.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1], sum[2] + point[2]] as [number, number, number],
    [0, 0, 0] as [number, number, number],
  );
  return [totals[0] / points.length, totals[1] / points.length, totals[2] / points.length];
}

/** Derives the ordered drive line encoded as one AI BSP material per checkpoint polygon. */
export function deriveTrackDefinition(
  world: BspWorld,
  lapData: LapDataDefinition,
  spawnHeight = 1.05,
): DerivedTrackDefinition {
  const trianglesByMaterial = new Map<number, TrackTriangle[]>();
  for (const sector of world.worldSectors) {
    for (let triangleIndex = 0; triangleIndex < sector.triangleCount; triangleIndex += 1) {
      const materialId = sector.triangleMaterialIndices[triangleIndex];
      if (materialId === undefined) {
        throw new Error(`AI BSP sector ${sector.index} is missing material for triangle ${triangleIndex}`);
      }
      const offset = triangleIndex * 3;
      const triangle: TrackTriangle = [
        vertex(sector.positions, sector.indices[offset]!),
        vertex(sector.positions, sector.indices[offset + 1]!),
        vertex(sector.positions, sector.indices[offset + 2]!),
      ];
      const materialTriangles = trianglesByMaterial.get(materialId) ?? [];
      materialTriangles.push(triangle);
      trianglesByMaterial.set(materialId, materialTriangles);
    }
  }

  const firstId = lapData.line[0]!;
  const lastId = lapData.line.at(-1)!;
  const direction = firstId <= lastId ? 1 : -1;
  const checkpoints: DerivedTrackCheckpoint[] = [];
  for (let id = firstId; ; id += direction) {
    const triangles = trianglesByMaterial.get(id);
    if (!triangles || triangles.length === 0) {
      throw new Error(`AI BSP has no checkpoint polygon for material ${id}`);
    }
    checkpoints.push({ id, center: checkpointCenter(triangles), triangles });
    if (id === lastId) {
      break;
    }
  }
  if (checkpoints.length < 2) {
    throw new Error("AI BSP drive line needs at least two checkpoint polygons");
  }

  const first = checkpoints[0]!.center;
  const next = checkpoints[1]!.center;
  const headingRadians = Math.atan2(next[0] - first[0], next[2] - first[2]);
  return {
    checkpoints,
    splitCheckpointIds: [...lapData.splitCheckpointIds],
    safeStartRanges: [...lapData.safeStartRanges],
    spawn: {
      position: [first[0], first[1] + spawnHeight, first[2]],
      headingRadians,
    },
  };
}
