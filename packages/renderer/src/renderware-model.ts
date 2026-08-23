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
  scale = 1,
): RenderWareModelBuild {
  const root = new THREE.Group();
  const matrices = renderWareFrameMatrices(model.frames);
  const textureNames = new Set<string>();
  let atomics = 0;
  let triangles = 0;
  model.atomics.forEach((atomic, atomicIndex) => {
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
