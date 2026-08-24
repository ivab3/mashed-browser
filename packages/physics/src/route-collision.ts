import type { LapCheckpoint } from "@mashed/core";

export interface RouteCollisionSector {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface RouteCollisionLayers {
  drive: readonly RouteCollisionSector[];
  scenery: readonly RouteCollisionSector[];
}

function checkpointFloor(checkpoint: LapCheckpoint): number {
  return Math.min(...checkpoint.triangles.flatMap((triangle) => triangle.map((point) => point[1])));
}

function appendTriangle(target: number[], indices: Uint32Array, offset: number): void {
  target.push(indices[offset]!, indices[offset + 1]!, indices[offset + 2]!);
}

function triangleHeightAt(
  first: readonly [number, number, number],
  second: readonly [number, number, number],
  third: readonly [number, number, number],
  x: number,
  z: number,
): number | undefined {
  const denominator = (second[2] - third[2]) * (first[0] - third[0])
    + (third[0] - second[0]) * (first[2] - third[2]);
  if (Math.abs(denominator) < 1e-7) {
    return undefined;
  }
  const firstWeight = ((second[2] - third[2]) * (x - third[0])
    + (third[0] - second[0]) * (z - third[2])) / denominator;
  const secondWeight = ((third[2] - first[2]) * (x - third[0])
    + (first[0] - third[0]) * (z - third[2])) / denominator;
  const thirdWeight = 1 - firstWeight - secondWeight;
  if (firstWeight < -1e-5 || secondWeight < -1e-5 || thirdWeight < -1e-5) {
    return undefined;
  }
  return firstWeight * first[1] + secondWeight * second[1] + thirdWeight * third[1];
}

function closestSurfaceHeightAt(
  sectors: readonly RouteCollisionSector[],
  x: number,
  z: number,
  expectedHeight: number,
): number | undefined {
  let closest: number | undefined;
  for (const sector of sectors) {
    const point = (index: number): readonly [number, number, number] => {
      const offset = index * 3;
      return [sector.positions[offset]!, sector.positions[offset + 1]!, sector.positions[offset + 2]!];
    };
    for (let offset = 0; offset < sector.indices.length; offset += 3) {
      const first = point(sector.indices[offset]!);
      const second = point(sector.indices[offset + 1]!);
      const third = point(sector.indices[offset + 2]!);
      const edgeA = [second[0] - first[0], second[2] - first[2]] as const;
      const edgeB = [third[0] - first[0], third[2] - first[2]] as const;
      if (edgeA[1] * edgeB[0] - edgeA[0] * edgeB[1] <= 1e-5) {
        continue;
      }
      const height = triangleHeightAt(first, second, third, x, z);
      if (height !== undefined && (
        closest === undefined || Math.abs(height - expectedHeight) < Math.abs(closest - expectedHeight)
      )) {
        closest = height;
      }
    }
  }
  return closest;
}

/** Separates wheel road/scenery hits and builds a continuous support ribbon along the AI route. */
export function deriveRouteCollisionLayers(
  course: { checkpoints: readonly LapCheckpoint[] },
  sectors: readonly RouteCollisionSector[],
  routeHalfWidth = 3.25,
  maximumSurfaceDrop = 0.45,
): RouteCollisionLayers {
  const floors = course.checkpoints.map(checkpointFloor);
  const drive: RouteCollisionSector[] = [];
  const scenery: RouteCollisionSector[] = [];

  for (const sector of sectors) {
    const driveIndices: number[] = [];
    const sceneryIndices: number[] = [];
    const point = (index: number): readonly [number, number, number] => {
      const offset = index * 3;
      return [sector.positions[offset]!, sector.positions[offset + 1]!, sector.positions[offset + 2]!];
    };
    for (let offset = 0; offset < sector.indices.length; offset += 3) {
      const first = point(sector.indices[offset]!);
      const second = point(sector.indices[offset + 1]!);
      const third = point(sector.indices[offset + 2]!);
      const edgeA = [second[0] - first[0], second[1] - first[1], second[2] - first[2]] as const;
      const edgeB = [third[0] - first[0], third[1] - first[1], third[2] - first[2]] as const;
      const normalY = edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2];
      const center = [
        (first[0] + second[0] + third[0]) / 3,
        (first[1] + second[1] + third[1]) / 3,
        (first[2] + second[2] + third[2]) / 3,
      ] as const;
      let nearestDistance = Number.POSITIVE_INFINITY;
      let expectedFloor = center[1];
      let closestRouteHeightDifference = Number.POSITIVE_INFINITY;
      for (let checkpointIndex = 0; checkpointIndex < course.checkpoints.length; checkpointIndex += 1) {
        const start = course.checkpoints[checkpointIndex]!.center;
        const finish = course.checkpoints[(checkpointIndex + 1) % course.checkpoints.length]!.center;
        const dx = finish[0] - start[0];
        const dz = finish[2] - start[2];
        const lengthSquared = dx * dx + dz * dz;
        const alpha = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0,
          ((center[0] - start[0]) * dx + (center[2] - start[2]) * dz) / lengthSquared,
        ));
        const distance = Math.hypot(
          center[0] - (start[0] + dx * alpha),
          center[2] - (start[2] + dz * alpha),
        );
        if (distance < nearestDistance) {
          nearestDistance = distance;
          expectedFloor = floors[checkpointIndex]!
            + (floors[(checkpointIndex + 1) % floors.length]! - floors[checkpointIndex]!) * alpha;
        }
        if (normalY > 1e-5) {
          for (let sample = 1; sample < 12; sample += 1) {
            const routeAlpha = sample / 12;
            const routeX = start[0] + dx * routeAlpha;
            const routeZ = start[2] + dz * routeAlpha;
            const height = triangleHeightAt(first, second, third, routeX, routeZ);
            const routeFloor = floors[checkpointIndex]!
              + (floors[(checkpointIndex + 1) % floors.length]! - floors[checkpointIndex]!) * routeAlpha;
            if (height !== undefined) {
              const difference = routeFloor - height;
              if (Math.abs(difference) < Math.abs(closestRouteHeightDifference)) {
                closestRouteHeightDifference = difference;
              }
            }
          }
        }
      }
      const deepRouteUnderlay = normalY > 1e-5
        && ((Number.isFinite(closestRouteHeightDifference)
          && closestRouteHeightDifference > maximumSurfaceDrop) || (
          !Number.isFinite(closestRouteHeightDifference)
          && nearestDistance <= routeHalfWidth
          && center[1] < expectedFloor - maximumSurfaceDrop
        ));
      const maximumHeight = Math.max(first[1], second[1], third[1]);
      const belowRouteScenery = normalY <= 1e-5
        && nearestDistance <= routeHalfWidth
        && maximumHeight <= expectedFloor + 0.15;
      if (deepRouteUnderlay || belowRouteScenery) {
        continue;
      }
      appendTriangle(normalY > 1e-5 ? driveIndices : sceneryIndices, sector.indices, offset);
    }
    if (driveIndices.length > 0) {
      drive.push({ positions: sector.positions, indices: new Uint32Array(driveIndices) });
    }
    if (sceneryIndices.length > 0) {
      scenery.push({ positions: sector.positions, indices: new Uint32Array(sceneryIndices) });
    }
  }

  const supportPositions = new Float32Array(course.checkpoints.length * 6);
  const supportIndices = new Uint32Array(course.checkpoints.length * 6);
  const supportHalfWidth = routeHalfWidth;
  for (let index = 0; index < course.checkpoints.length; index += 1) {
    const previous = course.checkpoints[
      (index - 1 + course.checkpoints.length) % course.checkpoints.length
    ]!.center;
    const current = course.checkpoints[index]!.center;
    const next = course.checkpoints[(index + 1) % course.checkpoints.length]!.center;
    const directionX = next[0] - previous[0];
    const directionZ = next[2] - previous[2];
    const directionLength = Math.hypot(directionX, directionZ);
    const sideX = directionLength < 1e-5 ? supportHalfWidth : -directionZ / directionLength * supportHalfWidth;
    const sideZ = directionLength < 1e-5 ? 0 : directionX / directionLength * supportHalfWidth;
    const surfaceHeight = closestSurfaceHeightAt(
      sectors,
      current[0],
      current[2],
      floors[index]!,
    ) ?? floors[index]!;
    const positionOffset = index * 6;
    supportPositions.set([
      current[0] + sideX, surfaceHeight + 0.02, current[2] + sideZ,
      current[0] - sideX, surfaceHeight + 0.02, current[2] - sideZ,
    ], positionOffset);

    const nextIndex = (index + 1) % course.checkpoints.length;
    const vertex = index * 2;
    const nextVertex = nextIndex * 2;
    supportIndices.set([
      vertex, nextVertex, vertex + 1,
      vertex + 1, nextVertex, nextVertex + 1,
    ], index * 6);
  }
  drive.push({ positions: supportPositions, indices: supportIndices });
  return { drive, scenery };
}
