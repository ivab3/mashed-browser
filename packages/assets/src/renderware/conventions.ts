export const RW_GEOMETRY_FLAGS = {
  triangleStrip: 0x01,
  positions: 0x02,
  textured: 0x04,
  prelit: 0x08,
  normals: 0x10,
  light: 0x20,
  modulateMaterialColor: 0x40,
  textured2: 0x80,
  native: 0x0100_0000,
  nativeInstance: 0x0200_0000,
} as const;

export const MASHED_ASSET_CONVENTIONS = {
  coordinateSystem: {
    handedness: "right-handed",
    rightAxis: "+x",
    upAxis: "+y",
    forwardAxis: "+z",
  },
  triangleWinding: "counter-clockwise",
  worldUnit: "RenderWare world unit",
  bspToWorldScale: 1,
  dffToWorldScale: 5,
} as const;

export function textureCoordinateSetCount(format: number): number {
  const explicit = (format >>> 16) & 0xff;
  if (explicit > 0) {
    return explicit;
  }
  if ((format & RW_GEOMETRY_FLAGS.textured2) !== 0) {
    return 2;
  }
  return (format & RW_GEOMETRY_FLAGS.textured) !== 0 ? 1 : 0;
}

export interface TriangleWindingAnalysis {
  aligned: number;
  opposed: number;
  degenerate: number;
}

export function analyzeTriangleWinding(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
): TriangleWindingAnalysis {
  const result: TriangleWindingAnalysis = { aligned: 0, opposed: 0, degenerate: 0 };
  for (let offset = 0; offset < indices.length; offset += 3) {
    const vertexA = indices[offset]! * 3;
    const vertexB = indices[offset + 1]! * 3;
    const vertexC = indices[offset + 2]! * 3;
    const edgeAb: [number, number, number] = [
      positions[vertexB]! - positions[vertexA]!,
      positions[vertexB + 1]! - positions[vertexA + 1]!,
      positions[vertexB + 2]! - positions[vertexA + 2]!,
    ];
    const edgeAc: [number, number, number] = [
      positions[vertexC]! - positions[vertexA]!,
      positions[vertexC + 1]! - positions[vertexA + 1]!,
      positions[vertexC + 2]! - positions[vertexA + 2]!,
    ];
    const faceNormal: [number, number, number] = [
      edgeAb[1] * edgeAc[2] - edgeAb[2] * edgeAc[1],
      edgeAb[2] * edgeAc[0] - edgeAb[0] * edgeAc[2],
      edgeAb[0] * edgeAc[1] - edgeAb[1] * edgeAc[0],
    ];
    const normal: [number, number, number] = [
      normals[vertexA]! + normals[vertexB]! + normals[vertexC]!,
      normals[vertexA + 1]! + normals[vertexB + 1]! + normals[vertexC + 1]!,
      normals[vertexA + 2]! + normals[vertexB + 2]! + normals[vertexC + 2]!,
    ];
    const agreement = faceNormal[0] * normal[0] + faceNormal[1] * normal[1] + faceNormal[2] * normal[2];
    if (agreement > 1e-7) {
      result.aligned += 1;
    } else if (agreement < -1e-7) {
      result.opposed += 1;
    } else {
      result.degenerate += 1;
    }
  }
  return result;
}

export function basisDeterminant(
  right: readonly [number, number, number],
  up: readonly [number, number, number],
  forward: readonly [number, number, number],
): number {
  return right[0] * (up[1] * forward[2] - up[2] * forward[1])
    - up[0] * (right[1] * forward[2] - right[2] * forward[1])
    + forward[0] * (right[1] * up[2] - right[2] * up[1]);
}
