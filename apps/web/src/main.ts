import { AudioRuntime } from "@mashed/audio";
import {
  FixedStepClock,
  RuntimeEventBus,
  RuntimeStateMachine,
  type FixedStepFrame,
  type RuntimeState,
} from "@mashed/core";
import { BrowserVehicleInput } from "@mashed/input";
import { createPhysicsRuntime, type PhysicsRuntime } from "@mashed/physics";
import { RuntimeRenderer } from "@mashed/renderer";

import { AssetLoadingClient } from "./asset-loader.js";
import type { LoadedAsset } from "./loading-protocol.js";
import "./style.css";

function element<T extends HTMLElement>(id: string): T {
  const result = document.querySelector<T>(`#${id}`);
  if (!result) {
    throw new Error(`Missing #${id}`);
  }
  return result;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function assetSummary(asset: LoadedAsset): string {
  switch (asset.kind) {
    case "dff":
      return `${asset.data.geometries.length} geometries · ${asset.data.frames.length} frames`;
    case "txd":
      return `${asset.data.textures.length} textures`;
    case "bsp":
      return `${asset.data.worldSectors.length} sectors · ${asset.data.header.triangleCount} triangles`;
  }
}

const STEP_SECONDS = 1 / 60;
const viewport = element<HTMLElement>("viewport");
const stateBadge = element<HTMLElement>("state-badge");
const runtimeStatus = element<HTMLElement>("runtime-status");
const assetStatus = element<HTMLElement>("asset-status");
const assetInput = element<HTMLInputElement>("asset-files");
const startButton = element<HTMLButtonElement>("start-race");
const finishButton = element<HTMLButtonElement>("finish-race");
const menuButton = element<HTMLButtonElement>("back-menu");
const resetButton = element<HTMLButtonElement>("reset-demo");
const debugCamera = element<HTMLInputElement>("debug-camera");
const debugColliders = element<HTMLInputElement>("debug-colliders");
const metricFps = element<HTMLElement>("metric-fps");
const metricFrame = element<HTMLElement>("metric-frame");
const metricPhysics = element<HTMLElement>("metric-physics");
const metricDraws = element<HTMLElement>("metric-draws");
const metricBodies = element<HTMLElement>("metric-bodies");
const metricContacts = element<HTMLElement>("metric-contacts");
const metricStep = element<HTMLElement>("metric-step");
const metricDropped = element<HTMLElement>("metric-dropped");
const metricSpeed = element<HTMLElement>("metric-speed");
const metricWheels = element<HTMLElement>("metric-wheels");
const metricSurface = element<HTMLElement>("metric-surface");

const events = new RuntimeEventBus();
const state = new RuntimeStateMachine(events);
const clock = new FixedStepClock({ stepSeconds: STEP_SECONDS, maxSubSteps: 8, events });
const audio = new AudioRuntime(events);
const renderer = new RuntimeRenderer(viewport, events);
const vehicleInput = new BrowserVehicleInput();
const assetLoader = new AssetLoadingClient();
const loadedAssets = new Map<string, LoadedAsset>();
let physics: PhysicsRuntime | undefined;
let animationFrame = 0;
let lastRenderTimestamp: number | undefined;
let smoothedFps = 60;
let lastOverlayUpdate = 0;
let physicsMilliseconds = 0;
let totalDroppedSeconds = 0;

function applyState(next: RuntimeState): void {
  stateBadge.textContent = next;
  stateBadge.dataset["state"] = next;
  startButton.disabled = next !== "menu" && next !== "results";
  startButton.textContent = next === "results" ? "Race again" : "Start simulation";
  finishButton.disabled = next !== "race";
  menuButton.disabled = next !== "race" && next !== "results";
  assetInput.disabled = next === "loading" || next === "race";
}

events.subscribe((event) => {
  if (event.type === "runtime:state-changed") {
    applyState(event.to);
    runtimeStatus.textContent = event.reason;
  } else if (event.type === "simulation:overrun") {
    totalDroppedSeconds += event.droppedSeconds;
  }
});
applyState(state.state);

async function startRace(): Promise<void> {
  if (!physics || (state.state !== "menu" && state.state !== "results")) {
    return;
  }
  await audio.unlock();
  physics.resetDemo();
  clock.restart(performance.now() / 1000);
  totalDroppedSeconds = 0;
  state.transition("race", "Fixed-step simulation running");
  events.emit({ type: "audio:cue", cue: "race-start", gain: 0.08 });
}

startButton.addEventListener("click", () => {
  void startRace();
});
finishButton.addEventListener("click", () => {
  if (state.state === "race") {
    state.transition("results", "Simulation completed without clock drift");
    events.emit({ type: "audio:cue", cue: "race-finish", gain: 0.08 });
  }
});
menuButton.addEventListener("click", () => {
  if (state.state === "race" || state.state === "results") {
    state.transition("menu", "Runtime ready");
    events.emit({ type: "audio:cue", cue: "menu", gain: 0.05 });
  }
});
resetButton.addEventListener("click", () => physics?.resetDemo());
debugCamera.addEventListener("change", () => renderer.setDebugCamera(debugCamera.checked));

assetInput.addEventListener("change", () => {
  const files = [...(assetInput.files ?? [])];
  if (files.length === 0 || (state.state !== "menu" && state.state !== "results")) {
    return;
  }
  void (async () => {
    state.transition("loading", `Parsing ${files.length} local asset${files.length === 1 ? "" : "s"}…`);
    try {
      const summaries: string[] = [];
      for (const file of files) {
        const result = await assetLoader.load(file);
        loadedAssets.set(file.name, result.asset);
        summaries.push(
          `${file.name}: ${assetSummary(result.asset)}, ${result.parseMilliseconds.toFixed(1)} ms, ${formatBytes(result.transferredBytes)} transferred`,
        );
      }
      assetStatus.textContent = summaries.join(" · ");
      state.transition("menu", `${loadedAssets.size} asset${loadedAssets.size === 1 ? "" : "s"} cached in memory`);
    } catch (error) {
      assetStatus.textContent = error instanceof Error ? error.message : String(error);
      state.transition("menu", "Asset parsing failed; runtime remains available");
    } finally {
      assetInput.value = "";
    }
  })();
});

function resetPresentationClock(): void {
  clock.reset(performance.now() / 1000);
  lastRenderTimestamp = undefined;
  events.emit({
    type: "runtime:focus-changed",
    focused: !document.hidden && document.hasFocus(),
  });
}

document.addEventListener("visibilitychange", resetPresentationClock);
window.addEventListener("blur", resetPresentationClock);
window.addEventListener("focus", resetPresentationClock);
window.addEventListener("resize", () => renderer.resize(viewport.clientWidth, viewport.clientHeight));
window.addEventListener("keydown", (event) => {
  if (event.code === "KeyC") {
    debugColliders.checked = !debugColliders.checked;
  }
});

function renderFrame(timestampMilliseconds: number): void {
  if (!physics) {
    return;
  }
  const renderDeltaSeconds = lastRenderTimestamp === undefined
    ? 0
    : Math.min((timestampMilliseconds - lastRenderTimestamp) / 1000, 0.25);
  lastRenderTimestamp = timestampMilliseconds;
  if (renderDeltaSeconds > 0) {
    const instantaneousFps = 1 / renderDeltaSeconds;
    smoothedFps += (instantaneousFps - smoothedFps) * 0.08;
  }

  physicsMilliseconds = 0;
  let frame: FixedStepFrame;
  if (state.state === "race") {
    frame = clock.advance(timestampMilliseconds / 1000, (stepSeconds) => {
      const startedAt = performance.now();
      physics?.step(stepSeconds, vehicleInput.sample());
      physicsMilliseconds += performance.now() - startedAt;
    });
  } else {
    clock.reset(timestampMilliseconds / 1000);
    frame = {
      frameDeltaSeconds: renderDeltaSeconds,
      simulatedSteps: 0,
      simulationStep: clock.simulationStep,
      interpolationAlpha: 0,
      droppedSeconds: 0,
    };
  }
  renderer.render({
    history: physics.transformHistory,
    interpolationAlpha: frame.interpolationAlpha,
    frameDeltaSeconds: renderDeltaSeconds,
    ...(debugColliders.checked ? { debugLines: physics.debugLines() } : {}),
  });

  if (timestampMilliseconds - lastOverlayUpdate >= 200) {
    const physicsMetrics = physics.metrics;
    const renderMetrics = renderer.metrics;
    metricFps.textContent = smoothedFps.toFixed(0);
    metricFrame.textContent = `${(renderDeltaSeconds * 1000).toFixed(2)} ms`;
    metricPhysics.textContent = `${physicsMilliseconds.toFixed(2)} ms`;
    metricDraws.textContent = String(renderMetrics.drawCalls);
    metricBodies.textContent = `${physicsMetrics.bodies} / ${physicsMetrics.colliders}`;
    metricContacts.textContent = String(physicsMetrics.contacts);
    metricStep.textContent = String(frame.simulationStep);
    metricDropped.textContent = `${(totalDroppedSeconds * 1000).toFixed(0)} ms`;
    metricSpeed.textContent = `${(physics.telemetry.speedMetersPerSecond * 3.6).toFixed(0)} km/h`;
    metricWheels.textContent = `${physics.telemetry.groundedWheels} / 4`;
    metricSurface.textContent = physics.telemetry.surface;
    lastOverlayUpdate = timestampMilliseconds;
  }
  animationFrame = requestAnimationFrame(renderFrame);
}

async function boot(): Promise<void> {
  state.transition("loading", "Loading Rapier WebAssembly…");
  try {
    physics = await createPhysicsRuntime(events, STEP_SECONDS);
    state.transition("menu", "Runtime ready");
    clock.reset(performance.now() / 1000);
    animationFrame = requestAnimationFrame(renderFrame);
  } catch (error) {
    runtimeStatus.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

window.addEventListener("pagehide", () => {
  cancelAnimationFrame(animationFrame);
  assetLoader.dispose();
  vehicleInput.dispose();
  physics?.dispose();
  renderer.dispose();
  void audio.dispose();
}, { once: true });

void boot();
