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
  readonly #vehicle: THREE.Group;
  readonly #cameraTarget = new THREE.Vector3(-4, 0.8, -5);
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
      this.#scene.add(ground);
    }
    const grid = new THREE.GridHelper(64, 64, 0x78909a, 0x263d43);
    grid.position.y = 0.008;
    this.#scene.add(grid);
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
      this.#scene.add(wall);
    }

    this.#vehicle = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xff6a32,
      roughness: 0.34,
      metalness: 0.28,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.5, 2.68), bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    this.#vehicle.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.34, 0.84), bodyMaterial);
    nose.position.set(0, -0.03, 1.25);
    nose.castShadow = true;
    this.#vehicle.add(nose);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.38, 1.05),
      new THREE.MeshStandardMaterial({ color: 0x172a33, roughness: 0.2, metalness: 0.5 }),
    );
    cabin.position.set(0, 0.4, -0.18);
    cabin.castShadow = true;
    this.#vehicle.add(cabin);
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
      this.#vehicle.add(wheel);
    }
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
      const vehiclePosition = new THREE.Vector3(...transform.position);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.#vehicle.quaternion);
      forward.y = 0;
      if (forward.lengthSq() < 0.001) {
        forward.set(0, 0, 1);
      } else {
        forward.normalize();
      }
      const desired = vehiclePosition.clone().addScaledVector(forward, -7.5);
      desired.y += 4.5;
      const desiredTarget = vehiclePosition.clone().addScaledVector(forward, 2.8);
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

  dispose(): void {
    this.#unsubscribe();
    this.#controls.dispose();
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
    this.#debugGeometry.dispose();
    this.#debugMaterial.dispose();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }
}
