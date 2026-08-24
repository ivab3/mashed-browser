import { interpolateTransform, type RuntimeEventBus } from "@mashed/core";
import type {
  PhysicsDebugLines,
  PhysicsSceneObject,
  PhysicsTransformHistory,
} from "@mashed/physics";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import {
  buildRenderWareTextures,
  buildRenderWareTrack,
  type RenderWareTrackTextureDictionary,
  type RenderWareTrackWorld,
} from "./renderware-track.js";
import {
  buildRenderWareModel,
  fitVehicleModelRoot,
  selectIntactVehicleAtomicIndices,
  type RenderWareModel,
} from "./renderware-model.js";
import { fitSharedCamera } from "./camera-fit.js";

export type {
  RenderWareTrackTextureDictionary,
  RenderWareTrackWorld,
} from "./renderware-track.js";
export type { RenderWareModel } from "./renderware-model.js";
export { fitSharedCamera, type CameraSubject, type SharedCameraFit } from "./camera-fit.js";

function disposeRenderableRoot(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    object.geometry.dispose();
    if (Array.isArray(object.material)) {
      object.material.forEach((material) => material.dispose());
    } else {
      object.material.dispose();
    }
  });
}

export interface RenderFrame {
  history: PhysicsTransformHistory;
  interpolationAlpha: number;
  frameDeltaSeconds: number;
  objects?: readonly PhysicsSceneObject[];
  debugLines?: PhysicsDebugLines;
}

export interface RendererMetrics {
  drawCalls: number;
  triangles: number;
}

export interface TrackRenderSector {
  positions: Float32Array;
  normals?: Float32Array;
  colors?: Uint8Array;
  indices: Uint32Array;
}

export interface TrackRoutePoint {
  center: readonly [number, number, number];
}

export interface TrackRenderStats {
  triangles: number;
  materials: number;
  textures: number;
  missingTextureNames: readonly string[];
}

export interface CourseModelSource {
  name: string;
  model: RenderWareModel;
}

export interface CourseRenderStats {
  models: number;
  skippedLocalTemplates: number;
  atomics: number;
  triangles: number;
  missingTextureNames: readonly string[];
}

export interface VehicleRenderStats {
  atomics: number;
  triangles: number;
  textures: number;
  lengthMeters: number;
  modelScale: number;
  missingTextureNames: readonly string[];
}

export class RuntimeRenderer {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
  readonly #controls: OrbitControls;
  readonly #vehicle: THREE.Group;
  readonly #vehicleProxy = new THREE.Group();
  readonly #demoRoot = new THREE.Group();
  readonly #sceneObjects = new Map<string, THREE.Mesh>();
  readonly #cameraTarget = new THREE.Vector3(-4, 0.8, -5);
  readonly #debugGeometry = new THREE.BufferGeometry();
  readonly #debugMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  readonly #debugLines: THREE.LineSegments;
  readonly #unsubscribe: () => void;
  readonly #baseBackground = new THREE.Color(0x091018);
  readonly #flashColor = new THREE.Color(0xff7a42);
  #flashRemainingSeconds = 0;
  #debugCameraEnabled = false;
  #trackRoot: THREE.Group | undefined;
  #trackTextures: THREE.DataTexture[] = [];
  #trackTextureMap: ReadonlyMap<string, THREE.DataTexture> = new Map();
  #courseRoot: THREE.Group | undefined;
  #vehicleModelRoot: THREE.Group | undefined;
  #vehicleTextures: THREE.DataTexture[] = [];
  #trackRoute: THREE.LineLoop | undefined;

  constructor(viewport: HTMLElement, events: RuntimeEventBus) {
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.shadowMap.enabled = true;
    viewport.append(this.#renderer.domElement);

    this.#scene.background = this.#baseBackground.clone();
    this.#scene.fog = new THREE.FogExp2(0x091018, 0.025);
    this.#camera.position.set(-4, 5.2, -15.5);
    this.#controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    this.#controls.target.set(0, 1, 0);
    this.#controls.enableDamping = true;
    this.#controls.enabled = false;

    const hemisphere = new THREE.HemisphereLight(0xb9ddff, 0x17202b, 2.2);
    this.#scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xffe7c2, 3.6);
    key.position.set(5, 10, 4);
    key.castShadow = true;
    this.#scene.add(key);
    this.#scene.add(this.#demoRoot);

    const surfaceColors = [0x9bc5e5, 0x293b40, 0xb99052, 0x574836];
    for (let index = 0; index < surfaceColors.length; index += 1) {
      const ground = new THREE.Mesh(
        new THREE.BoxGeometry(8, 0.4, 70),
        new THREE.MeshStandardMaterial({
          color: surfaceColors[index] ?? 0x293b40,
          roughness: index === 0 ? 0.24 : 0.86,
          metalness: index === 0 ? 0.18 : 0.03,
        }),
      );
      ground.position.set(-12 + index * 8, -0.2, 0);
      ground.receiveShadow = true;
      this.#demoRoot.add(ground);
    }
    const grid = new THREE.GridHelper(64, 64, 0x78909a, 0x263d43);
    grid.position.y = 0.008;
    this.#demoRoot.add(grid);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x3b4d53, roughness: 0.7 });
    const wallSpecs: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
      [-16.25, 0.8, 0, 0.5, 2, 70],
      [16.25, 0.8, 0, 0.5, 2, 70],
      [0, 0.8, -35.25, 32, 2, 0.5],
      [0, 0.8, 35.25, 32, 2, 0.5],
    ];
    for (const [x, y, z, width, height, depth] of wallSpecs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMaterial);
      wall.position.set(x, y, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.#demoRoot.add(wall);
    }

    this.#vehicle = new THREE.Group();
    this.#vehicleProxy.name = "vehicle-proxy";
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xff6a32,
      roughness: 0.34,
      metalness: 0.28,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.5, 2.68), bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    this.#vehicleProxy.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.34, 0.84), bodyMaterial);
    nose.position.set(0, -0.03, 1.25);
    nose.castShadow = true;
    this.#vehicleProxy.add(nose);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.38, 1.05),
      new THREE.MeshStandardMaterial({ color: 0x172a33, roughness: 0.2, metalness: 0.5 }),
    );
    cabin.position.set(0, 0.4, -0.18);
    cabin.castShadow = true;
    this.#vehicleProxy.add(cabin);
    const wheelGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16);
    wheelGeometry.rotateZ(Math.PI / 2);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x101417, roughness: 0.96 });
    for (const [x, y, z] of [
      [-0.89, -0.16, 0.94],
      [0.89, -0.16, 0.94],
      [-0.89, -0.16, -0.92],
      [0.89, -0.16, -0.92],
    ] as const) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.position.set(x, y, z);
      wheel.castShadow = true;
      this.#vehicleProxy.add(wheel);
    }
    this.#vehicle.add(this.#vehicleProxy);
    this.#scene.add(this.#vehicle);

    this.#debugLines = new THREE.LineSegments(this.#debugGeometry, this.#debugMaterial);
    this.#debugLines.frustumCulled = false;
    this.#debugLines.visible = false;
    this.#scene.add(this.#debugLines);

    this.#unsubscribe = events.subscribe((event) => {
      if (event.type === "renderer:flash") {
        this.#flashColor.setHex(event.color);
        this.#flashRemainingSeconds = Math.max(this.#flashRemainingSeconds, event.durationSeconds);
      }
    });
    this.resize(viewport.clientWidth, viewport.clientHeight);
  }

  get metrics(): RendererMetrics {
    return {
      drawCalls: this.#renderer.info.render.calls,
      triangles: this.#renderer.info.render.triangles,
    };
  }

  setTrackGeometry(sectors: readonly TrackRenderSector[]): number {
    this.clearTrackGeometry();
    const root = new THREE.Group();
    root.name = "loaded-track";
    let triangleCount = 0;
    for (const [index, sector] of sectors.entries()) {
      if (sector.positions.length === 0 || sector.indices.length === 0) {
        continue;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(sector.positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(sector.indices, 1));
      if (sector.normals) {
        geometry.setAttribute("normal", new THREE.BufferAttribute(sector.normals, 3));
      } else {
        geometry.computeVertexNormals();
      }
      if (sector.colors) {
        const colors = new Float32Array((sector.colors.length / 4) * 3);
        for (let source = 0, destination = 0; source < sector.colors.length; source += 4, destination += 3) {
          colors[destination] = sector.colors[source]! / 255;
          colors[destination + 1] = sector.colors[source + 1]! / 255;
          colors[destination + 2] = sector.colors[source + 2]! / 255;
        }
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: sector.colors ? 0xffffff : 0x78909a,
          vertexColors: sector.colors !== undefined,
          roughness: 0.88,
          metalness: 0.02,
          side: THREE.DoubleSide,
        }),
      );
      mesh.name = `track-sector-${index}`;
      mesh.receiveShadow = true;
      root.add(mesh);
      triangleCount += sector.indices.length / 3;
    }
    this.#trackRoot = root;
    this.#scene.add(root);
    this.#demoRoot.visible = false;
    if (this.#scene.fog instanceof THREE.FogExp2) {
      this.#scene.fog.density = 0.008;
    }
    return triangleCount;
  }

  setTrackWorld(
    world: RenderWareTrackWorld,
    dictionary?: RenderWareTrackTextureDictionary,
  ): TrackRenderStats {
    this.clearTrackGeometry();
    const track = buildRenderWareTrack(world, dictionary);
    this.#trackRoot = track.root;
    this.#trackTextures = track.textures;
    this.#trackTextureMap = track.textureMap;
    this.#scene.add(track.root);
    this.#demoRoot.visible = false;
    if (this.#scene.fog instanceof THREE.FogExp2) {
      this.#scene.fog.density = 0.008;
    }
    return {
      triangles: track.triangleCount,
      materials: track.materialCount,
      textures: track.textureCount,
      missingTextureNames: track.missingTextureNames,
    };
  }

  setCourseModels(sources: readonly CourseModelSource[]): CourseRenderStats {
    this.clearCourseModels();
    const root = new THREE.Group();
    root.name = "loaded-course-models";
    let models = 0;
    let skippedLocalTemplates = 0;
    let atomics = 0;
    let triangles = 0;
    const missingTextureNames = new Set<string>();
    for (const source of sources) {
      const built = buildRenderWareModel(source.model, this.#trackTextureMap);
      built.root.name = source.name;
      if (built.placement === "local-template") {
        disposeRenderableRoot(built.root);
        skippedLocalTemplates += 1;
        continue;
      }
      root.add(built.root);
      models += 1;
      atomics += built.atomics;
      triangles += built.triangles;
      built.missingTextureNames.forEach((name) => missingTextureNames.add(name));
    }
    this.#courseRoot = root;
    this.#scene.add(root);
    return {
      models,
      skippedLocalTemplates,
      atomics,
      triangles,
      missingTextureNames: [...missingTextureNames],
    };
  }

  clearCourseModels(): void {
    if (!this.#courseRoot) {
      return;
    }
    this.#scene.remove(this.#courseRoot);
    disposeRenderableRoot(this.#courseRoot);
    this.#courseRoot = undefined;
  }

  setVehicleModel(
    model: RenderWareModel,
    dictionary?: RenderWareTrackTextureDictionary,
  ): VehicleRenderStats {
    this.clearVehicleModel();
    const textureSet = buildRenderWareTextures(dictionary);
    const atomicIndices = selectIntactVehicleAtomicIndices(model);
    const built = buildRenderWareModel(model, textureSet.byName, { atomicIndices });
    const fit = fitVehicleModelRoot(built.root);
    built.root.name = "loaded-vehicle-model";
    this.#vehicleModelRoot = built.root;
    this.#vehicleTextures = textureSet.owned;
    this.#vehicle.add(built.root);
    this.#vehicleProxy.visible = false;
    return {
      atomics: built.atomics,
      triangles: built.triangles,
      textures: textureSet.owned.length,
      lengthMeters: fit.size[2],
      modelScale: fit.scale,
      missingTextureNames: built.missingTextureNames,
    };
  }

  clearVehicleModel(): void {
    if (this.#vehicleModelRoot) {
      this.#vehicle.remove(this.#vehicleModelRoot);
      disposeRenderableRoot(this.#vehicleModelRoot);
      this.#vehicleModelRoot = undefined;
    }
    this.#vehicleTextures.forEach((texture) => texture.dispose());
    this.#vehicleTextures = [];
    this.#vehicleProxy.visible = true;
  }

  setTrackRoute(points: readonly TrackRoutePoint[]): void {
    if (this.#trackRoute) {
      this.#scene.remove(this.#trackRoute);
      this.#trackRoute.geometry.dispose();
      (this.#trackRoute.material as THREE.Material).dispose();
      this.#trackRoute = undefined;
    }
    if (points.length < 2) {
      return;
    }
    const positions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      positions.set([point.center[0], point.center[1] + 0.12, point.center[2]], index * 3);
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xff8a4c, transparent: true, opacity: 0.72 });
    this.#trackRoute = new THREE.LineLoop(geometry, material);
    this.#trackRoute.name = "track-route";
    this.#trackRoute.frustumCulled = false;
    this.#scene.add(this.#trackRoute);
    this.#demoRoot.visible = false;
  }

  clearTrackGeometry(): void {
    this.clearCourseModels();
    if (this.#trackRoot) {
      this.#scene.remove(this.#trackRoot);
      disposeRenderableRoot(this.#trackRoot);
      this.#trackRoot = undefined;
    }
    for (const texture of this.#trackTextures) {
      texture.dispose();
    }
    this.#trackTextures = [];
    this.#trackTextureMap = new Map();
    this.#demoRoot.visible = true;
    if (this.#scene.fog instanceof THREE.FogExp2) {
      this.#scene.fog.density = 0.025;
    }
  }

  setDebugCamera(enabled: boolean): void {
    this.#debugCameraEnabled = enabled;
    this.#controls.enabled = enabled;
    if (enabled) {
      this.#controls.target.copy(this.#cameraTarget);
      this.#controls.update();
    }
  }

  resize(width: number, height: number): void {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    this.#renderer.setSize(safeWidth, safeHeight, false);
    this.#camera.aspect = safeWidth / safeHeight;
    this.#camera.updateProjectionMatrix();
  }

  render(frame: RenderFrame): void {
    const transform = interpolateTransform(
      frame.history.previous,
      frame.history.current,
      frame.interpolationAlpha,
    );
    this.#vehicle.position.fromArray(transform.position);
    this.#vehicle.quaternion.fromArray(transform.rotation);
    this.#syncSceneObjects(frame.objects ?? [], frame.interpolationAlpha);

    if (this.#debugCameraEnabled) {
      this.#controls.update();
    } else {
      const cameraSubjects = [
        transform,
        ...(frame.objects ?? [])
          .filter((object) => object.kind === "vehicle" && object.active)
          .map((object) => interpolateTransform(
            object.history.previous,
            object.history.current,
            frame.interpolationAlpha,
          )),
      ];
      const fit = fitSharedCamera(cameraSubjects);
      const cameraCenter = new THREE.Vector3(...fit.center);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.#vehicle.quaternion);
      forward.y = 0;
      if (forward.lengthSq() < 0.001) {
        forward.set(0, 0, 1);
      } else {
        forward.normalize();
      }
      const desired = cameraCenter.clone().addScaledVector(forward, -fit.trailMeters);
      desired.y += fit.heightMeters;
      const desiredTarget = cameraCenter.clone().addScaledVector(forward, fit.lookAheadMeters);
      desiredTarget.y += 0.45;
      const followAlpha = 1 - Math.exp(-5.2 * Math.min(frame.frameDeltaSeconds, 0.1));
      if (this.#camera.position.distanceToSquared(desired) > 400) {
        this.#camera.position.copy(desired);
        this.#cameraTarget.copy(desiredTarget);
      } else {
        this.#camera.position.lerp(desired, followAlpha);
        this.#cameraTarget.lerp(desiredTarget, followAlpha);
      }
      this.#camera.lookAt(this.#cameraTarget);
    }

    this.#updateDebugLines(frame.debugLines);
    this.#flashRemainingSeconds = Math.max(0, this.#flashRemainingSeconds - frame.frameDeltaSeconds);
    const flashMix = Math.min(0.22, this.#flashRemainingSeconds * 1.8);
    if (this.#scene.background instanceof THREE.Color) {
      this.#scene.background.copy(this.#baseBackground).lerp(this.#flashColor, flashMix);
    }
    this.#renderer.render(this.#scene, this.#camera);
  }

  #updateDebugLines(lines: PhysicsDebugLines | undefined): void {
    this.#debugLines.visible = lines !== undefined;
    if (!lines) {
      return;
    }
    const colors = new Float32Array((lines.colors.length / 4) * 3);
    for (let source = 0, destination = 0; source < lines.colors.length; source += 4, destination += 3) {
      colors[destination] = lines.colors[source] ?? 1;
      colors[destination + 1] = lines.colors[source + 1] ?? 1;
      colors[destination + 2] = lines.colors[source + 2] ?? 1;
    }
    this.#debugGeometry.setAttribute("position", new THREE.BufferAttribute(lines.vertices, 3));
    this.#debugGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.#debugGeometry.computeBoundingSphere();
  }

  #syncSceneObjects(objects: readonly PhysicsSceneObject[], interpolationAlpha: number): void {
    const present = new Set<string>();
    for (const object of objects) {
      present.add(object.id);
      let mesh = this.#sceneObjects.get(object.id);
      if (!mesh) {
        mesh = this.#createSceneObject(object);
        this.#sceneObjects.set(object.id, mesh);
        this.#scene.add(mesh);
      }
      mesh.visible = object.active;
      if (!object.active) {
        continue;
      }
      const transform = interpolateTransform(
        object.history.previous,
        object.history.current,
        interpolationAlpha,
      );
      mesh.position.fromArray(transform.position);
      mesh.quaternion.fromArray(transform.rotation);
    }
    for (const [id, mesh] of this.#sceneObjects) {
      if (!present.has(id)) {
        mesh.visible = false;
      }
    }
  }

  #createSceneObject(object: PhysicsSceneObject): THREE.Mesh {
    const geometry = object.kind === "barrel"
      ? new THREE.CylinderGeometry(0.42, 0.42, 1.1, 18)
      : object.kind === "vehicle"
        ? new THREE.BoxGeometry(1.72, 0.5, 3.02)
      : object.kind === "block"
        ? new THREE.BoxGeometry(1.6, 1.5, 1.6)
        : new THREE.BoxGeometry(1.1, 1.1, 1.1);
    const color = object.kind === "barrel"
      ? 0xd94b3d
      : object.kind === "vehicle"
        ? 0x3994d8
        : object.kind === "block" ? 0x718087 : 0xe0a43b;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: object.destructible ? 0.68 : 0.9,
      metalness: object.kind === "barrel" || object.kind === "vehicle" ? 0.28 : 0.05,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = object.id;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  dispose(): void {
    this.#unsubscribe();
    this.#controls.dispose();
    this.clearTrackGeometry();
    this.clearVehicleModel();
    if (this.#trackRoute) {
      this.#scene.remove(this.#trackRoute);
      this.#trackRoute.geometry.dispose();
      (this.#trackRoute.material as THREE.Material).dispose();
      this.#trackRoute = undefined;
    }
    this.#vehicle.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      object.geometry.dispose();
      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material.dispose();
      }
    });
    for (const mesh of this.#sceneObjects.values()) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        mesh.material.dispose();
      }
    }
    this.#sceneObjects.clear();
    this.#debugGeometry.dispose();
    this.#debugMaterial.dispose();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }
}
