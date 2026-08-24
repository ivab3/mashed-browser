import * as THREE from "three";

import {
  buildRenderWareMaterials,
  groupSectorMaterials,
  renderWareColorAttribute,
  type RenderWareTrackMaterial,
} from "./renderware-track.js";

export interface RenderWareModelFrame {
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  at: readonly [number, number, number];
  position: readonly [number, number, number];
  parentIndex: number;
}

export interface RenderWareModelGeometry {
  format: number;
  vertexCount: number;
  triangleCount: number;
  colors?: Uint8Array;
  uvSets: readonly Float32Array[];
  indices: Uint32Array;
  triangleMaterialIndices: Uint16Array;
  morphTargets: ReadonlyArray<{
    positions?: Float32Array;
    normals?: Float32Array;
  }>;
  materials: readonly RenderWareTrackMaterial[];
  userData?: ReadonlyArray<{
    name: string;
    type: "int" | "float" | "string";
    values: readonly (number | string)[];
  }>;
}

export interface RenderWareModelAtomic {
  frameIndex: number;
  geometryIndex: number;
}

export interface RenderWareModel {
  frames: readonly RenderWareModelFrame[];
  geometries: readonly RenderWareModelGeometry[];
  atomics: readonly RenderWareModelAtomic[];
}

export interface RenderWareModelBuild {
  root: THREE.Group;
  atomics: number;
  triangles: number;
  missingTextureNames: readonly string[];
  placement: "world-authored" | "local-template";
}

export interface RenderWareModelBuildOptions {
  scale?: number;
  atomicIndices?: ReadonlySet<number>;
}

export interface VehicleModelFit {
  scale: number;
  size: readonly [number, number, number];
}

export const DEFAULT_VEHICLE_MODEL_LENGTH_METERS = 3.02;
export const DEFAULT_VEHICLE_MODEL_GROUND_Y = -0.82;

function frameMatrix(frame: RenderWareModelFrame): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    frame.right[0], frame.up[0], frame.at[0], frame.position[0],
    frame.right[1], frame.up[1], frame.at[1], frame.position[1],
    frame.right[2], frame.up[2], frame.at[2], frame.position[2],
    0, 0, 0, 1,
  );
}

export function renderWareFrameMatrices(frames: readonly RenderWareModelFrame[]): THREE.Matrix4[] {
  const result: Array<THREE.Matrix4 | undefined> = new Array(frames.length);
  const resolving = new Set<number>();
  const resolve = (index: number): THREE.Matrix4 => {
    const cached = result[index];
    if (cached) {
      return cached;
    }
    if (resolving.has(index)) {
      throw new Error(`DFF frame hierarchy contains a cycle at frame ${index}`);
    }
    const frame = frames[index];
    if (!frame) {
      throw new Error(`DFF references missing frame ${index}`);
    }
    resolving.add(index);
    const local = frameMatrix(frame);
    const world = frame.parentIndex === -1
      ? local
      : resolve(frame.parentIndex).clone().multiply(local);
    resolving.delete(index);
    result[index] = world;
    return world;
  };
  return frames.map((_, index) => resolve(index));
}

function referencedTextures(materials: readonly RenderWareTrackMaterial[]): Set<string> {
  return new Set(materials.flatMap((material) => {
    const names: string[] = [];
    if (material.texture) {
      names.push(material.texture.name.toLocaleLowerCase("en-US"));
    }
    for (const effect of material.effects?.effects ?? []) {
      if (effect.texture) {
        names.push(effect.texture.name.toLocaleLowerCase("en-US"));
      }
    }
    return names;
  }));
}

function vehiclePartId(geometry: RenderWareModelGeometry): number | undefined {
  const entry = geometry.userData?.find((data) => data.name === "0.tv_part_id" && data.type === "int");
  const value = entry?.values[0];
  return typeof value === "number" ? value : undefined;
}

/**
 * Selects the intact high-detail vehicle pieces used by Mashed DFFs. Parts 59–62 are
 * collision hulls, 100–103 are low-detail full-car shells, 77 is broken glass, and
 * untextured one-triangle atomics are attachment markers rather than visible bodywork.
 */
export function selectIntactVehicleAtomicIndices(model: RenderWareModel): ReadonlySet<number> {
  const hasPartMetadata = model.geometries.some((geometry) => vehiclePartId(geometry) !== undefined);
  if (!hasPartMetadata) {
    return new Set(model.atomics.map((_, index) => index));
  }
  return new Set(model.atomics.flatMap((atomic, atomicIndex) => {
    const geometry = model.geometries[atomic.geometryIndex];
    if (!geometry) {
      return [];
    }
    const partId = vehiclePartId(geometry);
    const textureNames = referencedTextures(geometry.materials);
    const isHighDetailPart = partId !== undefined
      && (partId <= 58 || partId === 75 || partId === 76);
    const isBrokenGlass = textureNames.has("brokenglass") || partId === 77;
    return isHighDetailPart && textureNames.size > 0 && !isBrokenGlass ? [atomicIndex] : [];
  }));
}

function hasWorldPlacement(model: RenderWareModel, matrices: readonly THREE.Matrix4[]): boolean {
  const translation = new THREE.Vector3();
  for (const atomic of model.atomics) {
    const matrix = matrices[atomic.frameIndex];
    if (matrix) {
      translation.setFromMatrixPosition(matrix);
      if (Math.hypot(translation.x, translation.z) > 8) {
        return true;
      }
    }
    const positions = model.geometries[atomic.geometryIndex]?.morphTargets[0]?.positions;
    for (let offset = 0; offset < (positions?.length ?? 0); offset += 3) {
      if (Math.hypot(positions![offset]!, positions![offset + 2]!) > 8) {
        return true;
      }
    }
  }
  return false;
}

export function buildRenderWareModel(
  model: RenderWareModel,
  textures: ReadonlyMap<string, THREE.DataTexture>,
  options: number | RenderWareModelBuildOptions = 1,
): RenderWareModelBuild {
  const scale = typeof options === "number" ? options : options.scale ?? 1;
  const atomicIndices = typeof options === "number" ? undefined : options.atomicIndices;
  const root = new THREE.Group();
  const matrices = renderWareFrameMatrices(model.frames);
  const textureNames = new Set<string>();
  let atomics = 0;
  let triangles = 0;
  model.atomics.forEach((atomic, atomicIndex) => {
    if (atomicIndices && !atomicIndices.has(atomicIndex)) {
      return;
    }
    const source = model.geometries[atomic.geometryIndex];
    const morph = source?.morphTargets[0];
    if (!source || !morph?.positions || source.vertexCount === 0 || source.triangleCount === 0) {
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(morph.positions, 3));
    if (morph.normals) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(morph.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    const colors = renderWareColorAttribute(source.colors, source.vertexCount);
    if (colors) {
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    if (source.uvSets[0]) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(source.uvSets[0], 2));
    }
    if (source.uvSets[1]) {
      geometry.setAttribute("uv1", new THREE.BufferAttribute(source.uvSets[1], 2));
    }
    const materials = buildRenderWareMaterials(
      source.materials,
      textures,
      colors !== undefined,
      source.format,
    );
    groupSectorMaterials(geometry, source, materials.length);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = `atomic-${atomicIndex}`;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrices[atomic.frameIndex]!);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const name of referencedTextures(source.materials)) {
      textureNames.add(name);
    }
    atomics += 1;
    triangles += source.triangleCount;
  });
  root.scale.setScalar(scale);
  return {
    root,
    atomics,
    triangles,
    missingTextureNames: [...textureNames].filter((name) => !textures.has(name)),
    placement: hasWorldPlacement(model, matrices) ? "world-authored" : "local-template",
  };
}

/**
 * Vehicle DFFs contain real-car-sized geometry when the generic DFF x5 convention is
 * applied. The current physics profile uses a compact arcade footprint, so the visible
 * model keeps its authored +Z orientation and is uniformly fitted by length.
 */
export function fitVehicleModelRoot(
  root: THREE.Group,
  targetLengthMeters = DEFAULT_VEHICLE_MODEL_LENGTH_METERS,
  groundY = DEFAULT_VEHICLE_MODEL_GROUND_Y,
): VehicleModelFit {
  if (!Number.isFinite(targetLengthMeters) || targetLengthMeters <= 0) {
    throw new Error(`Vehicle model target length must be positive, got ${targetLengthMeters}`);
  }
  if (!Number.isFinite(groundY)) {
    throw new Error(`Vehicle model ground offset must be finite, got ${groundY}`);
  }
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);
  const sourceBounds = new THREE.Box3().setFromObject(root);
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  if (sourceBounds.isEmpty() || sourceSize.z <= 1e-6) {
    throw new Error("Vehicle model has no measurable longitudinal extent");
  }
  const scale = targetLengthMeters / sourceSize.z;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const fittedBounds = new THREE.Box3().setFromObject(root);
  const center = fittedBounds.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.y += groundY - fittedBounds.min.y;
  root.position.z -= center.z;
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  return {
    scale,
    size: [size.x, size.y, size.z],
  };
}
