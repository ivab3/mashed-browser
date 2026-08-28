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
  RaceSession,
  RuntimeEventBus,
  RuntimeStateMachine,
  type FixedStepFrame,
  type RaceEvent,
  type RuntimeState,
} from "@mashed/core";
import {
  BrowserVehicleInput,
  NEUTRAL_VEHICLE_INPUT,
  PLAYER_ONE_KEYBOARD_BINDINGS,
  PLAYER_TWO_KEYBOARD_BINDINGS,
} from "@mashed/input";
import {
  createPhysicsRuntime,
  deriveRouteCollisionLayers,
  PRIMARY_VEHICLE_ID,
  type PhysicsRuntime,
  type PhysicsRuntimeOptions,
} from "@mashed/physics";
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
const SECONDARY_VEHICLE_ID = "vehicle-two";
const vehiclePairLab = new URLSearchParams(window.location.search).get("collisionLab") === "vehicle-pair";

function selectedPhysicsOptions(): PhysicsRuntimeOptions {
  return vehiclePairLab
    ? {
        collisionObjects: false,
        collisionVehicle: {
          id: SECONDARY_VEHICLE_ID,
          spawn: { position: [-6, 1.05, -8], headingRadians: 0 },
        },
      }
    : {};
}

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
const metricSpeedLabel = element<HTMLElement>("metric-speed-label");
const metricWheelsLabel = element<HTMLElement>("metric-wheels-label");
const metricSurfaceLabel = element<HTMLElement>("metric-surface-label");
const metricPlayerTwoSpeedRow = element<HTMLElement>("metric-player-two-speed-row");
const metricPlayerTwoWheelsRow = element<HTMLElement>("metric-player-two-wheels-row");
const metricPlayerTwoSurfaceRow = element<HTMLElement>("metric-player-two-surface-row");
const metricPlayerTwoSpeed = element<HTMLElement>("metric-player-two-speed");
const metricPlayerTwoWheels = element<HTMLElement>("metric-player-two-wheels");
const metricPlayerTwoSurface = element<HTMLElement>("metric-player-two-surface");
const metricObjects = element<HTMLElement>("metric-objects");
const metricTrack = element<HTMLElement>("metric-track");
const metricLap = element<HTMLElement>("metric-lap");
const metricCheckpoint = element<HTMLElement>("metric-checkpoint");
const raceBanner = element<HTMLElement>("race-banner");
const raceBannerLabel = element<HTMLElement>("race-banner-label");
const raceBannerValue = element<HTMLElement>("race-banner-value");
const primaryDriveGuide = element<HTMLElement>("primary-drive-guide");
const primaryActionGuide = element<HTMLElement>("primary-action-guide");
const secondaryDriveGuide = element<HTMLElement>("secondary-drive-guide");
const secondaryActionGuide = element<HTMLElement>("secondary-action-guide");
const gamepadGuide = element<HTMLElement>("gamepad-guide");
const runtimeShortcuts = element<HTMLElement>("runtime-shortcuts");

const events = new RuntimeEventBus();
const state = new RuntimeStateMachine(events);
const clock = new FixedStepClock({ stepSeconds: STEP_SECONDS, maxSubSteps: 8, events });
const audio = new AudioRuntime(events);
const renderer = new RuntimeRenderer(viewport, events);
const vehicleInput = new BrowserVehicleInput(window, vehiclePairLab
  ? { gamepadIndex: 0, keyboard: PLAYER_ONE_KEYBOARD_BINDINGS }
  : {});
const secondaryVehicleInput = vehiclePairLab
  ? new BrowserVehicleInput(window, { gamepadIndex: 1, keyboard: PLAYER_TWO_KEYBOARD_BINDINGS })
  : undefined;
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
let raceSession: RaceSession | undefined;
let animationFrame = 0;
let lastRenderTimestamp: number | undefined;
let smoothedFps = 60;
let lastOverlayUpdate = 0;
let physicsMilliseconds = 0;
let totalDroppedSeconds = 0;

if (vehiclePairLab) {
  metricSpeedLabel.textContent = "P1 speed";
  metricWheelsLabel.textContent = "P1 wheels";
  metricSurfaceLabel.textContent = "P1 surface";
  metricPlayerTwoSpeedRow.hidden = false;
  metricPlayerTwoWheelsRow.hidden = false;
  metricPlayerTwoSurfaceRow.hidden = false;
  primaryDriveGuide.innerHTML = "<b>P1 · WASD</b> accelerate, reverse and steer";
  primaryActionGuide.innerHTML = "<b>Space</b> handbrake · <b>Left Shift</b> brake · <b>R</b> recover";
  secondaryDriveGuide.hidden = false;
  secondaryActionGuide.hidden = false;
  gamepadGuide.innerHTML = "<b>Gamepads 1 / 2</b> left stick · triggers · A/B/Y";
  resetButton.textContent = "Reset vehicles";
  runtimeShortcuts.textContent = "P1 WASD · P2 arrows · C colliders";
}

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

function formatRaceTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function applyRaceBanner(): void {
  const snapshot = raceSession?.snapshot;
  if (!snapshot || state.state === "menu" || snapshot.phase === "racing") {
    raceBanner.hidden = true;
    return;
  }
  raceBanner.hidden = false;
  if (snapshot.phase === "countdown") {
    raceBannerLabel.textContent = "Get ready";
    raceBannerValue.textContent = String(Math.max(1, Math.ceil(snapshot.countdownSecondsRemaining)));
    return;
  }

  const winner = snapshot.results[0];
  raceBannerLabel.textContent = winner?.status === "finished"
    ? `${winner.displayName} finished`
    : "Race over";
  raceBannerValue.textContent = winner ? formatRaceTime(winner.timeSeconds) : "—";
}

function createTrackRaceSession(): RaceSession | undefined {
  return trackDefinition
    ? new RaceSession({
        course: trackDefinition,
        players: [{ id: PRIMARY_VEHICLE_ID, displayName: "Player 1" }],
        totalLaps: 1,
        countdownSeconds: 3,
      })
    : undefined;
}

function handleRaceEvents(raceEvents: readonly RaceEvent[]): string | undefined {
  let finishReason: string | undefined;
  for (const event of raceEvents) {
    switch (event.type) {
      case "countdown-tick":
        runtimeStatus.textContent = `Race starts in ${event.secondsRemaining}`;
        break;
      case "race-started":
        runtimeStatus.textContent = "Go!";
        events.emit({ type: "audio:cue", cue: "race-start", gain: 0.08 });
        break;
      case "checkpoint-passed":
        runtimeStatus.textContent = `Checkpoint ${event.checkpointId} passed`;
        break;
      case "lap-completed":
        runtimeStatus.textContent = `Lap ${event.completedLaps} completed`;
        break;
      case "player-finished":
        finishReason = `Lap completed in ${formatRaceTime(event.timeSeconds)}`;
        break;
      case "player-eliminated":
        runtimeStatus.textContent = `${event.playerId} eliminated: ${event.reason}`;
        break;
      case "race-finished": {
        const winner = event.results[0];
        finishReason = winner?.status === "finished"
          ? `${winner.displayName} finished in ${formatRaceTime(winner.timeSeconds)}`
          : "All players eliminated";
        break;
      }
    }
  }
  applyRaceBanner();
  return finishReason;
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
  raceSession = createTrackRaceSession();
  clock.restart(performance.now() / 1000);
  totalDroppedSeconds = 0;
  state.transition("race", raceSession ? "Race countdown started" : "Fixed-step simulation running");
  applyRaceBanner();
  if (!raceSession) {
    events.emit({ type: "audio:cue", cue: "race-start", gain: 0.08 });
  }
}

startButton.addEventListener("click", () => {
  void startRace();
});
finishButton.addEventListener("click", () => {
  if (state.state === "race") {
    raceSession = undefined;
    state.transition("results", "Simulation completed without clock drift");
    applyRaceBanner();
    events.emit({ type: "audio:cue", cue: "race-finish", gain: 0.08 });
  }
});
menuButton.addEventListener("click", () => {
  if (state.state === "race" || state.state === "results") {
    raceSession = undefined;
    state.transition("menu", "Runtime ready");
    applyRaceBanner();
    events.emit({ type: "audio:cue", cue: "menu", gain: 0.05 });
  }
});
resetButton.addEventListener("click", () => {
  physics?.resetDemo();
  raceSession = state.state === "race" ? createTrackRaceSession() : undefined;
  applyRaceBanner();
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
  return `${pair.vehicleName} skin ${pair.variant} · ${rendered.atomics} intact atomics · ${rendered.triangles.toLocaleString()} triangles · ${rendered.lengthMeters.toFixed(2)} m long · ${rendered.textures} textures${rendered.missingTextureNames.length > 0 ? ` · ${rendered.missingTextureNames.length} missing vehicle maps` : ""}`;
}

function bindTrackParts(): string[] {
  const bound: string[] = [];
  if (trackParts.ai && trackParts.lapData && physics) {
    trackDefinition = deriveTrackDefinition(trackParts.ai, trackParts.lapData);
    physics.setRaceSpawn(trackDefinition.spawn);
    renderer.setTrackRoute(trackDefinition.checkpoints);
    bound.push(`${trackDefinition.checkpoints.length} ordered checkpoints`);
    applyState(state.state);
  }
  if (trackParts.collision && physics) {
    const triangles = physics.setTrackCollision(trackDefinition
      ? deriveRouteCollisionLayers(trackDefinition, trackParts.collision.worldSectors)
      : trackParts.collision.worldSectors);
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
    raceSession = undefined;
    applyRaceBanner();
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
  let raceFinishReason: string | undefined;
  let frame: FixedStepFrame;
  if (state.state === "race") {
    frame = clock.advance(timestampMilliseconds / 1000, (stepSeconds) => {
      const startedAt = performance.now();
      const gamepads = navigator.getGamepads();
      const raceEvents = raceSession?.advance(stepSeconds, {
        [PRIMARY_VEHICLE_ID]: physics?.transformHistory.current.position,
      }) ?? [];
      const eventFinishReason = handleRaceEvents(raceEvents);
      if (eventFinishReason) {
        raceFinishReason = eventFinishReason;
      }
      const controlsEnabled = !raceSession || raceSession.phase === "racing";
      physics?.step(
        stepSeconds,
        controlsEnabled ? vehicleInput.sample(gamepads) : NEUTRAL_VEHICLE_INPUT,
        secondaryVehicleInput
          ? { [SECONDARY_VEHICLE_ID]: secondaryVehicleInput.sample(gamepads) }
          : {},
      );
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
  if (raceFinishReason && state.state === "race") {
    state.transition("results", raceFinishReason);
    applyRaceBanner();
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
    const playerTwoTelemetry = physics.getVehicleTelemetry(SECONDARY_VEHICLE_ID);
    if (playerTwoTelemetry) {
      metricPlayerTwoSpeed.textContent = `${(playerTwoTelemetry.speedMetersPerSecond * 3.6).toFixed(0)} km/h`;
      metricPlayerTwoWheels.textContent = `${playerTwoTelemetry.groundedWheels} / 4`;
      metricPlayerTwoSurface.textContent = playerTwoTelemetry.surface;
    }
    metricObjects.textContent = `${physicsMetrics.activeObjects} / ${physicsMetrics.destroyedObjects}`;
    metricTrack.textContent = physicsMetrics.trackTriangles.toLocaleString();
    const raceSnapshot = raceSession?.snapshot;
    const playerRace = raceSnapshot?.players[0];
    const lapProgress = playerRace?.progress;
    metricLap.textContent = lapProgress && raceSnapshot
      ? `${Math.min(lapProgress.completedLaps + (playerRace.status === "finished" ? 0 : 1), raceSnapshot.totalLaps)} / ${raceSnapshot.totalLaps}`
      : "—";
    metricCheckpoint.textContent = lapProgress
      ? playerRace.status === "finished"
        ? `${lapProgress.totalCheckpoints} / ${lapProgress.totalCheckpoints} ✓`
        : `${lapProgress.passedCheckpoints} / ${lapProgress.totalCheckpoints} → ${lapProgress.nextCheckpointId}`
      : "—";
    lastOverlayUpdate = timestampMilliseconds;
  }
  animationFrame = requestAnimationFrame(renderFrame);
}

async function boot(): Promise<void> {
  state.transition("loading", "Loading Rapier WebAssembly…");
  try {
    physics = await createPhysicsRuntime(events, STEP_SECONDS, undefined, selectedPhysicsOptions());
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
  secondaryVehicleInput?.dispose();
  physics?.dispose();
  renderer.dispose();
  void audio.dispose();
}, { once: true });

void boot();
