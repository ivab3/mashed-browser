import { AudioRuntime } from "@mashed/audio";
import {
  deriveTrackDefinition,
  parseVehicleDffName,
  parseCourseLua,
  parseLapDataLua,
  selectVehicleAssetPair,
  type BspWorld,
  type CourseDefinition,
  type DerivedTrackDefinition,
  type DffModel,
  type LapDataDefinition,
  type PiTextureDictionary,
} from "@mashed/assets";
import {
  FixedStepClock,
  LapSession,
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
const metricObjects = element<HTMLElement>("metric-objects");
const metricTrack = element<HTMLElement>("metric-track");
const metricLap = element<HTMLElement>("metric-lap");
const metricCheckpoint = element<HTMLElement>("metric-checkpoint");

const events = new RuntimeEventBus();
const state = new RuntimeStateMachine(events);
const clock = new FixedStepClock({ stepSeconds: STEP_SECONDS, maxSubSteps: 8, events });
const audio = new AudioRuntime(events);
const renderer = new RuntimeRenderer(viewport, events);
const vehicleInput = new BrowserVehicleInput();
const assetLoader = new AssetLoadingClient();
const loadedAssets = new Map<string, LoadedAsset>();
const trackParts: {
  ai?: BspWorld;
  collision?: BspWorld;
  graphics?: BspWorld;
  lapData?: LapDataDefinition;
  course?: CourseDefinition;
} = {};
const loadedDffs = new Map<string, DffModel>();
const loadedTextureDictionaries = new Map<string, PiTextureDictionary>();
let physics: PhysicsRuntime | undefined;
let trackDefinition: DerivedTrackDefinition | undefined;
let lapSession: LapSession | undefined;
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
  startButton.textContent = next === "results"
    ? "Race again"
    : trackDefinition ? "Start lap" : "Start simulation";
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
  lapSession?.reset();
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
resetButton.addEventListener("click", () => {
  physics?.resetDemo();
  lapSession?.reset();
});
debugCamera.addEventListener("change", () => renderer.setDebugCamera(debugCamera.checked));

function rememberBsp(fileName: string, world: BspWorld): string | undefined {
  const normalized = fileName.toLocaleLowerCase("en-US");
  if (/^ai\d*\.bsp$/.test(normalized)) {
    trackParts.ai = world;
    return "AI route";
  }
  if (/collid/.test(normalized)) {
    trackParts.collision = world;
    return "collision";
  }
  if (/graphics|world/.test(normalized)) {
    trackParts.graphics = world;
    return "graphics";
  }
  return undefined;
}

function trackTextureDictionary(): PiTextureDictionary | undefined {
  const declaredName = trackParts.course?.textureDictionaryFileName?.toLocaleLowerCase("en-US");
  if (declaredName) {
    return loadedTextureDictionaries.get(declaredName);
  }
  const vehicleTextureNames = new Set([...loadedDffs.keys()].flatMap((fileName) => {
    const vehicle = parseVehicleDffName(fileName);
    return vehicle ? [vehicle.textureDictionaryFileName.toLocaleLowerCase("en-US")] : [];
  }));
  const candidates = [...loadedTextureDictionaries].filter(([fileName]) => !vehicleTextureNames.has(fileName));
  return candidates.length === 1 ? candidates[0]![1] : undefined;
}

function bindVehicleModel(): string | undefined {
  const pair = selectVehicleAssetPair(loadedDffs.keys(), loadedTextureDictionaries.keys());
  if (!pair) {
    return undefined;
  }
  const model = loadedDffs.get(pair.fileName.toLocaleLowerCase("en-US"));
  const textures = loadedTextureDictionaries.get(pair.textureFileName.toLocaleLowerCase("en-US"));
  if (!model || !textures) {
    return undefined;
  }
  const rendered = renderer.setVehicleModel(model, textures);
  return `${pair.vehicleName} skin ${pair.variant} · ${rendered.atomics} intact atomics · ${rendered.triangles.toLocaleString()} triangles · ${rendered.textures} textures${rendered.missingTextureNames.length > 0 ? ` · ${rendered.missingTextureNames.length} missing vehicle maps` : ""}`;
}

function bindTrackParts(): string[] {
  const bound: string[] = [];
  if (trackParts.collision && physics) {
    const triangles = physics.setTrackCollision(trackParts.collision.worldSectors);
    bound.push(`${triangles.toLocaleString()} collision triangles`);
  }
  if (trackParts.graphics) {
    const rendered = renderer.setTrackWorld(trackParts.graphics, trackTextureDictionary());
    bound.push(
      `${rendered.triangles.toLocaleString()} visible triangles · ${rendered.materials} materials · ${rendered.textures} textures${rendered.missingTextureNames.length > 0 ? ` · ${rendered.missingTextureNames.length} missing maps` : ""}`,
    );
  }
  if (trackParts.course) {
    const courseNames = new Map<string, string>();
    for (const asset of [
      ...trackParts.course.clumps.map((clump) => clump.fileName),
      ...trackParts.course.skies.map((sky) => sky.fileName),
      ...(trackParts.course.lightsFileName ? [trackParts.course.lightsFileName] : []),
    ]) {
      courseNames.set(asset.toLocaleLowerCase("en-US"), asset);
    }
    const models = [...courseNames].flatMap(([normalized, name]) => {
      const model = loadedDffs.get(normalized);
      return model ? [{ name, model }] : [];
    });
    const rendered = renderer.setCourseModels(models);
    if (models.length > 0) {
      bound.push(
        `${rendered.models}/${models.length} world-authored DFFs · ${rendered.atomics} atomics · ${rendered.triangles.toLocaleString()} triangles${rendered.skippedLocalTemplates > 0 ? ` · ${rendered.skippedLocalTemplates} local templates skipped` : ""}${rendered.missingTextureNames.length > 0 ? ` · ${rendered.missingTextureNames.length} missing DFF maps` : ""}`,
      );
    }
  }
  if (trackParts.ai && trackParts.lapData && physics) {
    trackDefinition = deriveTrackDefinition(trackParts.ai, trackParts.lapData);
    lapSession = new LapSession(trackDefinition);
    physics.setRaceSpawn(trackDefinition.spawn);
    renderer.setTrackRoute(trackDefinition.checkpoints);
    bound.push(`${trackDefinition.checkpoints.length} ordered checkpoints`);
    applyState(state.state);
  }
  const vehicle = bindVehicleModel();
  if (vehicle) {
    bound.push(`vehicle ${vehicle}`);
  }
  return bound;
}

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
        if (file.name.toLocaleLowerCase("en-US").endsWith(".lua")) {
          if (/lapdata/i.test(file.name)) {
            const startedAt = performance.now();
            trackParts.lapData = parseLapDataLua(await file.text());
            summaries.push(
              `${file.name}: ${trackParts.lapData.line.length} line anchors · ${trackParts.lapData.splitCheckpointIds.length} splits, ${(performance.now() - startedAt).toFixed(1)} ms`,
            );
          } else if (/course/i.test(file.name)) {
            const startedAt = performance.now();
            trackParts.course = parseCourseLua(await file.text());
            summaries.push(
              `${file.name}: course ${trackParts.course.id} · ${trackParts.course.clumps.length} clumps · ${trackParts.course.objectTemplates.length} object templates, ${(performance.now() - startedAt).toFixed(1)} ms`,
            );
          } else {
            summaries.push(`${file.name}: ignored (supported metadata: COURSE.LUA and LAPDATA.LUA)`);
          }
          continue;
        }
        const result = await assetLoader.load(file);
        loadedAssets.set(file.name.toLocaleLowerCase("en-US"), result.asset);
        let role: string | undefined;
        if (result.asset.kind === "bsp") {
          role = rememberBsp(file.name, result.asset.data);
        } else if (result.asset.kind === "txd") {
          loadedTextureDictionaries.set(file.name.toLocaleLowerCase("en-US"), result.asset.data);
          role = "texture dictionary candidate";
        } else if (result.asset.kind === "dff") {
          loadedDffs.set(file.name.toLocaleLowerCase("en-US"), result.asset.data);
          role = parseVehicleDffName(file.name) ? "vehicle skin candidate" : "course model candidate";
        }
        summaries.push(
          `${file.name}: ${assetSummary(result.asset)}, ${result.parseMilliseconds.toFixed(1)} ms, ${formatBytes(result.transferredBytes)} transferred${role ? ` · ${role}` : ""}`,
        );
      }
      const bound = bindTrackParts();
      assetStatus.textContent = [...summaries, ...(bound.length > 0 ? [`Track bound: ${bound.join(" · ")}`] : [])].join(" · ");
      state.transition(
        "menu",
        trackDefinition
          ? `Playable track ready · ${trackDefinition.checkpoints.length} checkpoints`
          : `${loadedAssets.size} asset${loadedAssets.size === 1 ? "" : "s"} cached in memory`,
      );
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
  let completedLapThisFrame = false;
  let frame: FixedStepFrame;
  if (state.state === "race") {
    frame = clock.advance(timestampMilliseconds / 1000, (stepSeconds) => {
      const startedAt = performance.now();
      physics?.step(stepSeconds, vehicleInput.sample());
      if (physics && lapSession?.update(physics.transformHistory.current.position).lapCompleted) {
        completedLapThisFrame = true;
      }
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
  if (completedLapThisFrame && state.state === "race") {
    state.transition("results", "Lap completed through every ordered checkpoint");
    events.emit({ type: "audio:cue", cue: "race-finish", gain: 0.08 });
  }
  renderer.render({
    history: physics.transformHistory,
    objects: physics.sceneObjects,
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
    metricObjects.textContent = `${physicsMetrics.activeObjects} / ${physicsMetrics.destroyedObjects}`;
    metricTrack.textContent = physicsMetrics.trackTriangles.toLocaleString();
    const lapProgress = lapSession?.progress;
    metricLap.textContent = lapProgress ? `${Math.min(lapProgress.completedLaps + 1, 1)} / 1` : "—";
    metricCheckpoint.textContent = lapProgress
      ? `${lapProgress.passedCheckpoints} / ${lapProgress.totalCheckpoints} → ${lapProgress.nextCheckpointId}`
      : "—";
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
