import {
  parseBspWorld,
  parseDff,
  parsePiTextureDictionary,
  MASHED_ASSET_CONVENTIONS,
  RW_GEOMETRY_FLAGS,
  RW_TEXTURE_ADDRESS_MODES,
  RW_TEXTURE_FILTER_MODES,
  type BspWorld,
  type BspWorldSector,
  type DffFrame,
  type DffModel,
  type PiTextureDictionary,
  type RenderWareMaterial,
} from "@mashed/assets";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import "./style.css";

function element<T extends HTMLElement>(id: string): T {
  const value = document.querySelector<T>(`#${id}`);
  if (!value) {
    throw new Error(`Missing #${id}`);
  }
  return value;
}

const viewport = element<HTMLElement>("viewport");
const dffInput = element<HTMLInputElement>("asset-file");
const textureInput = element<HTMLInputElement>("texture-file");
const worldInput = element<HTMLInputElement>("world-file");
const collisionInput = element<HTMLInputElement>("collision-file");
const assetName = element<HTMLElement>("asset-name");
const textureName = element<HTMLElement>("texture-name");
const collisionName = element<HTMLElement>("collision-name");
const assetStats = element<HTMLElement>("asset-stats");
const assetError = element<HTMLElement>("asset-error");
const chunkTitle = element<HTMLElement>("chunk-title");
const chunkList = element<HTMLElement>("chunk-list");
const gridToggle = element<HTMLInputElement>("show-grid");
const axesToggle = element<HTMLInputElement>("show-axes");
const wireframeToggle = element<HTMLInputElement>("wireframe");
const collisionToggle = element<HTMLInputElement>("show-collision");
const resetCameraButton = element<HTMLButtonElement>("reset-camera");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x11151c);
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10_000);
camera.position.set(4, 3, 5);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdce9ff, 0x303744, 2.4));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(4, 8, 6);
scene.add(keyLight);

let grid = new THREE.GridHelper(20, 40, 0x526174, 0x27303b);
scene.add(grid);
const axes = new THREE.AxesHelper(1);
scene.add(axes);

let assetRoot: THREE.Group | undefined;
let collisionRoot: THREE.Group | undefined;
type SurfaceMaterial = THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | THREE.ShaderMaterial;
let renderedSurfaceMeshes: Array<
  THREE.Mesh<THREE.BufferGeometry, SurfaceMaterial | SurfaceMaterial[]>
> = [];
let renderedTextures: THREE.DataTexture[] = [];
let loadedModel: DffModel | undefined;
let loadedWorld: BspWorld | undefined;
let loadedCollision: BspWorld | undefined;
let loadedDictionary: PiTextureDictionary | undefined;

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
  } else {
    material.dispose();
  }
}

function disposeRoot(): void {
  if (assetRoot) {
    scene.remove(assetRoot);
    assetRoot.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        disposeMaterial(object.material);
      }
    });
  }
  assetRoot = undefined;
  collisionRoot = undefined;
  renderedSurfaceMeshes = [];
  renderedTextures.forEach((texture) => texture.dispose());
  renderedTextures = [];
}

function resizeHelpers(bounds: THREE.Box3): void {
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 2);
  const order = 10 ** Math.floor(Math.log10(span));
  const gridSize = Math.ceil(span / order) * order * 1.2;
  scene.remove(grid);
  grid.geometry.dispose();
  disposeMaterial(grid.material);
  grid = new THREE.GridHelper(gridSize, 40, 0x526174, 0x27303b);
  grid.position.y = bounds.min.y - Math.max(span * 0.002, 0.005);
  grid.visible = gridToggle.checked;
  scene.add(grid);
  axes.scale.setScalar(Math.max(span * 0.08, 1));
}

function fitCamera(): void {
  if (!assetRoot) {
    return;
  }
  const bounds = new THREE.Box3().setFromObject(assetRoot);
  if (bounds.isEmpty()) {
    return;
  }
  resizeHelpers(bounds);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.7, 0.5);
  controls.target.copy(center);
  camera.near = Math.max(radius / 1000, 0.001);
  camera.far = radius * 100;
  camera.position.copy(center).add(new THREE.Vector3(1, 0.72, 1).normalize().multiplyScalar(radius * 2.3));
  camera.updateProjectionMatrix();
  controls.update();
}

function frameMatrix(frame: DffFrame): THREE.Matrix4 {
  return new THREE.Matrix4().set(
    frame.right[0], frame.up[0], frame.at[0], frame.position[0],
    frame.right[1], frame.up[1], frame.at[1], frame.position[1],
    frame.right[2], frame.up[2], frame.at[2], frame.position[2],
    0, 0, 0, 1,
  );
}

function worldFrameMatrices(frames: DffFrame[]): THREE.Matrix4[] {
  const result: Array<THREE.Matrix4 | undefined> = new Array(frames.length);
  const resolving = new Set<number>();
  const resolve = (index: number): THREE.Matrix4 => {
    const cached = result[index];
    if (cached) {
      return cached;
    }
    if (resolving.has(index)) {
      throw new Error(`Frame hierarchy contains a cycle at frame ${index}`);
    }
    resolving.add(index);
    const frame = frames[index]!;
    const local = frameMatrix(frame);
    const world = frame.parentIndex === -1 ? local : resolve(frame.parentIndex).clone().multiply(local);
    resolving.delete(index);
    result[index] = world;
    return world;
  };
  return frames.map((_, index) => resolve(index));
}

function geometryColors(colors: Uint8Array | undefined, vertexCount: number): Float32Array | undefined {
  if (!colors) {
    return undefined;
  }
  const result = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    result[index * 3] = colors[index * 4]! / 255;
    result[index * 3 + 1] = colors[index * 4 + 1]! / 255;
    result[index * 3 + 2] = colors[index * 4 + 2]! / 255;
  }
  return result;
}

function buildTextures(dictionary: PiTextureDictionary | undefined): Map<string, THREE.DataTexture> {
  const result = new Map<string, THREE.DataTexture>();
  for (const source of dictionary?.textures ?? []) {
    const base = source.mipmaps[0];
    if (!base) {
      continue;
    }
    const texture = new THREE.DataTexture(base.rgba, base.width, base.height, THREE.RGBAFormat);
    texture.name = source.name;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    const addressU = (source.filterFlags >>> 8) & 0x0f;
    const storedAddressV = (source.filterFlags >>> 12) & 0x0f;
    const addressV = storedAddressV === 0 ? addressU : storedAddressV;
    const wrapping = (address: number): THREE.Wrapping => {
      if (address === RW_TEXTURE_ADDRESS_MODES.mirror) {
        return THREE.MirroredRepeatWrapping;
      }
      if (address === RW_TEXTURE_ADDRESS_MODES.clamp || address === RW_TEXTURE_ADDRESS_MODES.border) {
        return THREE.ClampToEdgeWrapping;
      }
      return THREE.RepeatWrapping;
    };
    texture.wrapS = wrapping(addressU);
    texture.wrapT = wrapping(addressV);
    const filterMode = source.filterFlags & 0xff;
    texture.magFilter = filterMode === RW_TEXTURE_FILTER_MODES.nearest || filterMode === RW_TEXTURE_FILTER_MODES.mipNearest
      ? THREE.NearestFilter
      : THREE.LinearFilter;
    texture.minFilter = {
      [RW_TEXTURE_FILTER_MODES.nearest]: THREE.NearestFilter,
      [RW_TEXTURE_FILTER_MODES.linear]: THREE.LinearFilter,
      [RW_TEXTURE_FILTER_MODES.mipNearest]: THREE.NearestMipmapNearestFilter,
      [RW_TEXTURE_FILTER_MODES.mipLinear]: THREE.LinearMipmapNearestFilter,
      [RW_TEXTURE_FILTER_MODES.linearMipNearest]: THREE.NearestMipmapLinearFilter,
      [RW_TEXTURE_FILTER_MODES.linearMipLinear]: THREE.LinearMipmapLinearFilter,
    }[filterMode] ?? THREE.LinearFilter;
    const usesMipmaps = filterMode >= RW_TEXTURE_FILTER_MODES.mipNearest
      && filterMode <= RW_TEXTURE_FILTER_MODES.linearMipLinear;
    if (usesMipmaps && source.mipmaps.length > 1) {
      texture.mipmaps = source.mipmaps.map((mipmap) => ({
        data: mipmap.rgba,
        width: mipmap.width,
        height: mipmap.height,
      }));
      texture.generateMipmaps = false;
    } else {
      const autoMipmaps = (source.filterFlags & 0x1_0000) === 0;
      texture.generateMipmaps = usesMipmaps && autoMipmaps;
      if (usesMipmaps && !autoMipmaps) {
        texture.minFilter = texture.magFilter;
      }
    }
    texture.userData["alphaMode"] = base.alphaMode;
    texture.userData["hasTransparency"] = base.alphaMode !== "opaque";
    texture.userData["hasTranslucency"] = base.alphaMode === "blend";
    texture.needsUpdate = true;
    result.set(source.name.toLocaleLowerCase("en-US"), texture);
    renderedTextures.push(texture);
  }
  return result;
}

function buildMaterials(
  sourceMaterials: RenderWareMaterial[],
  textures: Map<string, THREE.DataTexture>,
  hasVertexColors: boolean,
  geometryFormat: number,
): SurfaceMaterial[] {
  const materials = sourceMaterials.length > 0
    ? sourceMaterials
    : [{
        flags: 0,
        color: [255, 255, 255, 255] as [number, number, number, number],
        unused: 0,
        surfaceProperties: { ambient: 1, specular: 1, diffuse: 1 },
        extensionChunks: [],
      }];
  return materials.map((material) => {
    const map = material.texture ? textures.get(material.texture.name.toLocaleLowerCase("en-US")) : undefined;
    const modulatesColor = (geometryFormat & RW_GEOMETRY_FLAGS.modulateMaterialColor) !== 0;
    const color: [number, number, number, number] = modulatesColor
      ? material.color
      : [255, 255, 255, material.color[3]];
    const hasTranslucency = map?.userData["hasTranslucency"] === true || (color[3] > 0 && color[3] < 255);
    const hasAlphaMask = map?.userData["hasTransparency"] === true && !hasTranslucency;
    const dualEffect = material.effects?.effects.find((effect) => effect.type === "dual");
    const dualMap = dualEffect?.type === "dual" && dualEffect.texture
      ? textures.get(dualEffect.texture.name.toLocaleLowerCase("en-US"))
      : undefined;
    const common = {
      color: new THREE.Color(color[0]! / 255, color[1]! / 255, color[2]! / 255),
      opacity: material.color[3] / 255,
      transparent: hasTranslucency,
      alphaTest: hasAlphaMask ? 0.5 : hasTranslucency ? 1 / 255 : 0,
      depthWrite: !hasTranslucency,
      map: map ?? null,
      vertexColors: hasVertexColors,
      side: THREE.FrontSide,
      wireframe: wireframeToggle.checked,
    };
    if (
      map
      && dualMap
      && dualEffect?.type === "dual"
      && dualEffect.sourceBlend === 5
      && dualEffect.destinationBlend === 6
      && (geometryFormat & RW_GEOMETRY_FLAGS.light) === 0
    ) {
      return new THREE.ShaderMaterial({
        uniforms: {
          baseMap: { value: map },
          dualMap: { value: dualMap },
          materialColor: { value: common.color },
          materialOpacity: { value: common.opacity },
          alphaThreshold: { value: common.alphaTest },
        },
        defines: hasVertexColors ? { USE_VERTEX_COLOR: 1 } : {},
        vertexShader: `
          attribute vec2 uv1;
          varying vec2 vBaseUv;
          varying vec2 vDualUv;
          #ifdef USE_VERTEX_COLOR
            attribute vec3 color;
            varying vec3 vVertexColor;
          #endif

          void main() {
            vBaseUv = uv;
            vDualUv = uv1;
            #ifdef USE_VERTEX_COLOR
              vVertexColor = color;
            #endif
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D baseMap;
          uniform sampler2D dualMap;
          uniform vec3 materialColor;
          uniform float materialOpacity;
          uniform float alphaThreshold;
          varying vec2 vBaseUv;
          varying vec2 vDualUv;
          #ifdef USE_VERTEX_COLOR
            varying vec3 vVertexColor;
          #endif

          void main() {
            vec4 base = texture2D(baseMap, vBaseUv);
            vec4 dual = texture2D(dualMap, vDualUv);
            vec4 outputColor = mix(base, dual, dual.a);
            outputColor.rgb *= materialColor;
            outputColor.a *= materialOpacity;
            #ifdef USE_VERTEX_COLOR
              outputColor.rgb *= vVertexColor;
            #endif
            if (outputColor.a < alphaThreshold) discard;
            gl_FragColor = outputColor;
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        transparent: common.transparent,
        depthWrite: common.depthWrite,
        side: common.side,
        wireframe: common.wireframe,
      });
    }
    if ((geometryFormat & RW_GEOMETRY_FLAGS.light) === 0) {
      return new THREE.MeshBasicMaterial(common);
    }
    return new THREE.MeshStandardMaterial({
      ...common,
      roughness: Math.max(0.15, 1 - material.surfaceProperties.specular * 0.25),
      metalness: 0,
    });
  });
}

function groupedIndices(
  geometry: THREE.BufferGeometry,
  triangleCount: number,
  sourceIndices: Uint32Array,
  triangleMaterialIndices: Uint16Array,
  materialCount: number,
): void {
  const groups = Array.from({ length: Math.max(materialCount, 1) }, () => [] as number[]);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const materialIndex = triangleMaterialIndices[triangle] ?? 0;
    const group = groups[materialIndex];
    if (!group) {
      throw new Error(`Triangle ${triangle} references missing material ${materialIndex}`);
    }
    group.push(
      sourceIndices[triangle * 3]!,
      sourceIndices[triangle * 3 + 1]!,
      sourceIndices[triangle * 3 + 2]!,
    );
  }
  const flattened = new Uint32Array(sourceIndices.length);
  let offset = 0;
  groups.forEach((indices, materialIndex) => {
    flattened.set(indices, offset);
    if (indices.length > 0) {
      geometry.addGroup(offset, indices.length, materialIndex);
    }
    offset += indices.length;
  });
  geometry.setIndex(new THREE.BufferAttribute(flattened, 1));
}

function createChunkRow(title: string, detail: string, object: THREE.Object3D): HTMLElement {
  const row = document.createElement("label");
  row.className = "chunk-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = true;
  checkbox.addEventListener("change", () => { object.visible = checkbox.checked; });
  const text = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = detail;
  text.append(strong, small);
  row.append(checkbox, text);
  return row;
}

function finalizeRender(root: THREE.Group, rows: HTMLElement[], emptyMessage: string): void {
  assetRoot = root;
  scene.add(root);
  chunkList.replaceChildren(...(
    rows.length > 0
      ? rows
      : [Object.assign(document.createElement("div"), { className: "empty", textContent: emptyMessage })]
  ));
  fitCamera();
}

function renderModel(model: DffModel): void {
  disposeRoot();
  const root = new THREE.Group();
  const matrices = worldFrameMatrices(model.frames);
  const textures = buildTextures(loadedDictionary);
  const rows: HTMLElement[] = [];
  let visibleCount = 0;

  model.atomics.forEach((atomic, atomicIndex) => {
    const source = model.geometries[atomic.geometryIndex]!;
    const morph = source.morphTargets[0];
    if (!morph?.positions || source.vertexCount === 0) {
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(morph.positions, 3));
    if (morph.normals) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(morph.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    const colors = geometryColors(source.colors, source.vertexCount);
    if (colors) {
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    if (source.uvSets[0]) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(source.uvSets[0], 2));
    }
    if (source.uvSets[1]) {
      geometry.setAttribute("uv1", new THREE.BufferAttribute(source.uvSets[1], 2));
    }
    const materials = buildMaterials(source.materials, textures, colors !== undefined, source.format);
    groupedIndices(
      geometry,
      source.triangleCount,
      source.indices,
      source.triangleMaterialIndices,
      materials.length,
    );
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = `atomic-${atomicIndex}`;
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrices[atomic.frameIndex]!);
    root.add(mesh);
    renderedSurfaceMeshes.push(mesh);
    visibleCount += 1;
    rows.push(createChunkRow(
      `Atomic ${atomicIndex}`,
      `frame ${atomic.frameIndex} · geometry ${atomic.geometryIndex} · ${source.vertexCount.toLocaleString()} verts · ${source.triangleCount.toLocaleString()} tris`,
      mesh,
    ));
  });
  collisionToggle.disabled = true;
  chunkTitle.textContent = "Atomic chunks";
  root.scale.setScalar(MASHED_ASSET_CONVENTIONS.dffToWorldScale);
  assetStats.textContent = `${model.frames.length} frames · ${model.geometries.length} geometries · ${model.atomics.length} atomics · ${visibleCount} visible meshes · ${loadedDictionary?.textures.length ?? 0} textures · world scale ×${MASHED_ASSET_CONVENTIONS.dffToWorldScale}`;
  finalizeRender(root, rows, "No renderable morph targets.");
}

function buildWorldSectorMesh(
  sector: BspWorldSector,
  world: BspWorld,
  textures: Map<string, THREE.DataTexture>,
): THREE.Mesh<THREE.BufferGeometry, SurfaceMaterial[]> | undefined {
  if (sector.vertexCount === 0 || sector.triangleCount === 0) {
    return undefined;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(sector.positions, 3));
  if (sector.normals) {
    geometry.setAttribute("normal", new THREE.BufferAttribute(sector.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  const colors = geometryColors(sector.colors, sector.vertexCount);
  if (colors) {
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
  if (sector.uvSets[0]) {
    geometry.setAttribute("uv", new THREE.BufferAttribute(sector.uvSets[0], 2));
  }
  if (sector.uvSets[1]) {
    geometry.setAttribute("uv1", new THREE.BufferAttribute(sector.uvSets[1], 2));
  }
  const materials = buildMaterials(world.materials, textures, colors !== undefined, world.header.format);
  groupedIndices(
    geometry,
    sector.triangleCount,
    sector.indices,
    sector.triangleMaterialIndices,
    materials.length,
  );
  return new THREE.Mesh(geometry, materials);
}

function addCollisionOverlay(root: THREE.Group, world: BspWorld): THREE.Group {
  const group = new THREE.Group();
  group.name = "collision-overlay";
  group.visible = collisionToggle.checked;
  for (const sector of world.worldSectors) {
    if (sector.vertexCount === 0 || sector.triangleCount === 0) {
      continue;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(sector.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(sector.indices, 1));
    const material = new THREE.MeshBasicMaterial({
      color: 0xff4f7b,
      wireframe: true,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 1000;
    group.add(mesh);
  }
  root.add(group);
  return group;
}

function renderWorld(world: BspWorld): void {
  disposeRoot();
  const root = new THREE.Group();
  const textures = buildTextures(loadedDictionary);
  const rows: HTMLElement[] = [];
  let visibleSectorCount = 0;
  for (const sector of world.worldSectors) {
    const mesh = buildWorldSectorMesh(sector, world, textures);
    if (!mesh) {
      continue;
    }
    mesh.name = `world-sector-${sector.index}`;
    root.add(mesh);
    renderedSurfaceMeshes.push(mesh);
    visibleSectorCount += 1;
    rows.push(createChunkRow(
      `World sector ${sector.index}`,
      `${sector.vertexCount.toLocaleString()} verts · ${sector.triangleCount.toLocaleString()} tris`,
      mesh,
    ));
  }
  if (loadedCollision) {
    collisionRoot = addCollisionOverlay(root, loadedCollision);
    collisionToggle.disabled = false;
  } else {
    collisionToggle.disabled = true;
  }
  chunkTitle.textContent = "World sectors";
  const collisionStats = loadedCollision
    ? ` · collision ${loadedCollision.header.vertexCount.toLocaleString()} verts / ${loadedCollision.header.triangleCount.toLocaleString()} tris`
    : "";
  assetStats.textContent = `${world.header.planeSectorCount} plane sectors · ${world.header.worldSectorCount} world sectors (${visibleSectorCount} non-empty) · ${world.header.vertexCount.toLocaleString()} verts · ${world.header.triangleCount.toLocaleString()} tris · ${world.materials.length} materials · ${loadedDictionary?.textures.length ?? 0} textures${collisionStats}`;
  finalizeRender(root, rows, "No non-empty world sectors.");
}

function showError(name: string, error: unknown): void {
  disposeRoot();
  assetName.textContent = name;
  assetStats.textContent = "Unable to parse asset.";
  assetError.textContent = error instanceof Error ? error.message : String(error);
  assetError.hidden = false;
}

async function loadDff(data: ArrayBuffer, name: string): Promise<void> {
  assetError.hidden = true;
  try {
    loadedModel = parseDff(data);
    loadedWorld = undefined;
    loadedCollision = undefined;
    collisionName.textContent = "No collision world loaded";
    assetName.textContent = name;
    renderModel(loadedModel);
  } catch (error: unknown) {
    showError(name, error);
  }
}

async function loadWorld(data: ArrayBuffer, name: string): Promise<void> {
  assetError.hidden = true;
  try {
    loadedWorld = parseBspWorld(data);
    loadedModel = undefined;
    assetName.textContent = name;
    renderWorld(loadedWorld);
  } catch (error: unknown) {
    showError(name, error);
  }
}

async function loadCollision(data: ArrayBuffer, name: string): Promise<void> {
  assetError.hidden = true;
  try {
    loadedCollision = parseBspWorld(data);
    collisionName.textContent = `${name} · ${loadedCollision.header.triangleCount.toLocaleString()} tris`;
    if (loadedWorld) {
      renderWorld(loadedWorld);
    }
  } catch (error: unknown) {
    assetError.textContent = error instanceof Error ? error.message : String(error);
    assetError.hidden = false;
  }
}

async function loadTxd(data: ArrayBuffer, name: string): Promise<void> {
  assetError.hidden = true;
  try {
    loadedDictionary = parsePiTextureDictionary(data);
    textureName.textContent = `${name} · ${loadedDictionary.textures.length} textures`;
    if (loadedModel) {
      renderModel(loadedModel);
    } else if (loadedWorld) {
      renderWorld(loadedWorld);
    }
  } catch (error: unknown) {
    assetError.textContent = error instanceof Error ? error.message : String(error);
    assetError.hidden = false;
  }
}

function loadSelectedFile(input: HTMLInputElement, loader: (data: ArrayBuffer, name: string) => Promise<void>): void {
  const file = input.files?.[0];
  if (file) {
    void file.arrayBuffer().then((data) => loader(data, file.name));
  }
}

dffInput.addEventListener("change", () => loadSelectedFile(dffInput, loadDff));
textureInput.addEventListener("change", () => loadSelectedFile(textureInput, loadTxd));
worldInput.addEventListener("change", () => loadSelectedFile(worldInput, loadWorld));
collisionInput.addEventListener("change", () => loadSelectedFile(collisionInput, loadCollision));
gridToggle.addEventListener("change", () => { grid.visible = gridToggle.checked; });
axesToggle.addEventListener("change", () => { axes.visible = axesToggle.checked; });
wireframeToggle.addEventListener("change", () => {
  renderedSurfaceMeshes.forEach((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => { material.wireframe = wireframeToggle.checked; });
  });
});
collisionToggle.addEventListener("change", () => {
  if (collisionRoot) {
    collisionRoot.visible = collisionToggle.checked;
  }
});
resetCameraButton.addEventListener("click", fitCamera);

const resizeObserver = new ResizeObserver(() => {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
});
resizeObserver.observe(viewport);

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

async function loadDevelopmentAsset(
  url: string | null,
  label: string,
  loader: (data: ArrayBuffer, name: string) => Promise<void>,
): Promise<void> {
  if (!url) {
    return;
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${label} request failed: ${response.status} ${response.statusText}`);
    }
    await loader(await response.arrayBuffer(), url.split("/").at(-1) ?? label);
  } catch (error: unknown) {
    assetError.textContent = error instanceof Error ? error.message : String(error);
    assetError.hidden = false;
  }
}

const parameters = new URLSearchParams(window.location.search);
void loadDevelopmentAsset(parameters.get("asset"), "Asset", loadDff);
void loadDevelopmentAsset(parameters.get("world"), "World", loadWorld);
void loadDevelopmentAsset(parameters.get("textures"), "Texture", loadTxd);
void loadDevelopmentAsset(parameters.get("collision"), "Collision", loadCollision);
