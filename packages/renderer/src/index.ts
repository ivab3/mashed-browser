import { interpolateTransform, type RuntimeEventBus } from "@mashed/core";
import type { PhysicsDebugLines, PhysicsTransformHistory } from "@mashed/physics";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface RenderFrame {
  history: PhysicsTransformHistory;
  interpolationAlpha: number;
  frameDeltaSeconds: number;
  debugLines?: PhysicsDebugLines;
}

export interface RendererMetrics {
  drawCalls: number;
  triangles: number;
}

export class RuntimeRenderer {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(48, 1, 0.05, 500);
  readonly #controls: OrbitControls;
  readonly #vehicle: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  readonly #debugGeometry = new THREE.BufferGeometry();
  readonly #debugMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  readonly #debugLines: THREE.LineSegments;
  readonly #unsubscribe: () => void;
  readonly #baseBackground = new THREE.Color(0x091018);
  readonly #flashColor = new THREE.Color(0xff7a42);
  #flashRemainingSeconds = 0;
  #debugCameraEnabled = false;

  constructor(viewport: HTMLElement, events: RuntimeEventBus) {
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.shadowMap.enabled = true;
    viewport.append(this.#renderer.domElement);

    this.#scene.background = this.#baseBackground.clone();
    this.#scene.fog = new THREE.FogExp2(0x091018, 0.025);
    this.#camera.position.set(7.5, 5.6, 9.5);
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

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(18, 0.5, 18),
      new THREE.MeshStandardMaterial({ color: 0x182a31, roughness: 0.78, metalness: 0.08 }),
    );
    ground.position.y = -0.25;
    ground.receiveShadow = true;
    this.#scene.add(ground);
    const grid = new THREE.GridHelper(18, 18, 0x5b7f89, 0x253d45);
    grid.position.y = 0.006;
    this.#scene.add(grid);

    this.#vehicle = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.7, 2.9),
      new THREE.MeshStandardMaterial({ color: 0xff6a32, roughness: 0.34, metalness: 0.28 }),
    );
    this.#vehicle.castShadow = true;
    this.#vehicle.receiveShadow = true;
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

  setDebugCamera(enabled: boolean): void {
    this.#debugCameraEnabled = enabled;
    this.#controls.enabled = enabled;
    if (enabled) {
      this.#controls.target.copy(this.#vehicle.position);
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

    if (this.#debugCameraEnabled) {
      this.#controls.update();
    } else {
      const desired = new THREE.Vector3(7.5, 5.6, 9.5).add(
        new THREE.Vector3(transform.position[0], 0, transform.position[2]),
      );
      this.#camera.position.lerp(desired, 0.05);
      this.#camera.lookAt(transform.position[0], 0.8, transform.position[2]);
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

  dispose(): void {
    this.#unsubscribe();
    this.#controls.dispose();
    this.#vehicle.geometry.dispose();
    this.#vehicle.material.dispose();
    this.#debugGeometry.dispose();
    this.#debugMaterial.dispose();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }
}
