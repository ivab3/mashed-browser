import { AudioRuntime } from "@mashed/audio";
import {
  deriveTrackDefinition,
  listVehicleAssetPairs,
  parseVehicleDffName,
  parseCourseLua,
  parseLapDataLua,
  type BspWorld,
  type CourseDefinition,
  type DerivedTrackDefinition,
  type DffModel,
  type LapDataDefinition,
  type PiTextureDictionary,
  type VehicleAssetPair,
} from "@mashed/assets";
import {
  CameraEliminationTracker,
  CombatSession,
  createLocalPlayerGrid,
  FixedStepClock,
  LOCAL_PLAYER_SLOTS,
  RaceSession,
  RuntimeEventBus,
  RuntimeStateMachine,
  type FixedStepFrame,
  type CameraEliminationWarning,
  type CombatEvent,
  type CombatPickupDefinition,
  type CombatPlayerFrames,
  type LocalPlayerGridSlot,
  type RaceEvent,
  type RuntimeState,
} from "@mashed/core";
import {
  BrowserVehicleInput,
  GAMEPAD_ONLY_KEYBOARD_BINDINGS,
  NEUTRAL_VEHICLE_INPUT,
  PLAYER_ONE_KEYBOARD_BINDINGS,
  PLAYER_TWO_KEYBOARD_BINDINGS,
  SINGLE_PLAYER_KEYBOARD_BINDINGS,
  type VehicleInputFrame,
} from "@mashed/input";
import {
  createPhysicsRuntime,
  DEFAULT_VEHICLE_CONFIG,
  deriveRouteCollisionLayers,
  PRIMARY_VEHICLE_ID,
  type PhysicsRuntime,
  type PhysicsRuntimeOptions,
  type VehicleInputById,
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
    case "rws":
      return `${asset.data.sounds.length} original sounds`;
  }
}

const STEP_SECONDS = 1 / 60;
const COMBAT_EFFECT_COLORS = Object.freeze({
  "machine-gun": 0xffcf4a,
  rocket: 0xff654f,
  mine: 0x8d6be8,
});
const vehiclePairLab = new URLSearchParams(window.location.search).get("collisionLab") === "vehicle-pair";

function selectedPhysicsOptions(): PhysicsRuntimeOptions {
  return vehiclePairLab ? { collisionObjects: false } : {};
}

const viewport = element<HTMLElement>("viewport");
const stateBadge = element<HTMLElement>("state-badge");
const runtimeStatus = element<HTMLElement>("runtime-status");
const assetStatus = element<HTMLElement>("asset-status");
const assetInput = element<HTMLInputElement>("asset-files");
const startButton = element<HTMLButtonElement>("start-race");
const pauseButton = element<HTMLButtonElement>("pause-race");
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
const metricObjects = element<HTMLElement>("metric-objects");
const metricTrack = element<HTMLElement>("metric-track");
const metricLap = element<HTMLElement>("metric-lap");
const metricCheckpoint = element<HTMLElement>("metric-checkpoint");
const raceBanner = element<HTMLElement>("race-banner");
const raceBannerLabel = element<HTMLElement>("race-banner-label");
const raceBannerValue = element<HTMLElement>("race-banner-value");
const raceResults = element<HTMLOListElement>("race-results");
const eliminationWarning = element<HTMLElement>("elimination-warning");
const pauseOverlay = element<HTMLElement>("pause-overlay");
const combatHud = element<HTMLElement>("combat-hud");
const combatPlayerRows = [
  element<HTMLElement>("combat-player-one"),
  element<HTMLElement>("combat-player-two"),
  element<HTMLElement>("combat-player-three"),
  element<HTMLElement>("combat-player-four"),
];
const primaryDriveGuide = element<HTMLElement>("primary-drive-guide");
const primaryActionGuide = element<HTMLElement>("primary-action-guide");
const secondaryDriveGuide = element<HTMLElement>("secondary-drive-guide");
const secondaryActionGuide = element<HTMLElement>("secondary-action-guide");
const gamepadGuide = element<HTMLElement>("gamepad-guide");
const runtimeShortcuts = element<HTMLElement>("runtime-shortcuts");
const playerCountSelect = element<HTMLSelectElement>("player-count");
const vehicleSelectRows = [
  element<HTMLElement>("vehicle-select-row-one"),
  element<HTMLElement>("vehicle-select-row-two"),
  element<HTMLElement>("vehicle-select-row-three"),
  element<HTMLElement>("vehicle-select-row-four"),
];
const vehicleSelects = [
  element<HTMLSelectElement>("vehicle-select-one"),
  element<HTMLSelectElement>("vehicle-select-two"),
  element<HTMLSelectElement>("vehicle-select-three"),
  element<HTMLSelectElement>("vehicle-select-four"),
];
const additionalPlayerMetrics = [
  {
    row: element<HTMLElement>("metric-player-two-row"),
    value: element<HTMLElement>("metric-player-two"),
  },
  {
    row: element<HTMLElement>("metric-player-three-row"),
    value: element<HTMLElement>("metric-player-three"),
  },
  {
    row: element<HTMLElement>("metric-player-four-row"),
    value: element<HTMLElement>("metric-player-four"),
  },
];

const events = new RuntimeEventBus();
const state = new RuntimeStateMachine(events);
const clock = new FixedStepClock({ stepSeconds: STEP_SECONDS, maxSubSteps: 8, events });
const audio = new AudioRuntime(events);
const renderer = new RuntimeRenderer(viewport, events);
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
let combatSession: CombatSession | undefined;
const cameraElimination = new CameraEliminationTracker();
let eliminationWarnings: readonly CameraEliminationWarning[] = [];
let vehicleInputs: BrowserVehicleInput[] = [];
let latestVehicleInputs: VehicleInputById = {};
let vehicleCatalog: readonly VehicleAssetPair[] = [];
let animationFrame = 0;
let lastRenderTimestamp: number | undefined;
let smoothedFps = 60;
let lastOverlayUpdate = 0;
let physicsMilliseconds = 0;
let totalDroppedSeconds = 0;

playerCountSelect.value = vehiclePairLab ? "2" : "1";

function selectedPlayerCount(): number {
  const value = Number(playerCountSelect.value);
  return Number.isInteger(value) && value >= 1 && value <= LOCAL_PLAYER_SLOTS.length ? value : 1;
}

function activePlayerSlots(): readonly (typeof LOCAL_PLAYER_SLOTS)[number][] {
  return LOCAL_PLAYER_SLOTS.slice(0, selectedPlayerCount());
}

function localRosterGrid(): readonly LocalPlayerGridSlot[] {
  return createLocalPlayerGrid(
    trackDefinition?.spawn ?? DEFAULT_VEHICLE_CONFIG.spawn,
    selectedPlayerCount(),
  );
}

function rebuildVehicleInputs(): void {
  vehicleInputs.forEach((input) => input.dispose());
  const count = selectedPlayerCount();
  vehicleInputs = activePlayerSlots().map((slot, index) => {
    const keyboard = count === 1
      ? SINGLE_PLAYER_KEYBOARD_BINDINGS
      : index === 0
        ? PLAYER_ONE_KEYBOARD_BINDINGS
        : index === 1
          ? PLAYER_TWO_KEYBOARD_BINDINGS
          : GAMEPAD_ONLY_KEYBOARD_BINDINGS;
    return new BrowserVehicleInput(window, { gamepadIndex: slot.gamepadIndex, keyboard });
  });
}

function applyRosterPresentation(): void {
  const count = selectedPlayerCount();
  const multiplayer = count > 1;
  metricSpeedLabel.textContent = multiplayer ? "P1 speed" : "Speed";
  metricWheelsLabel.textContent = multiplayer ? "P1 wheels" : "Wheels";
  metricSurfaceLabel.textContent = multiplayer ? "P1 surface" : "Surface";
  vehicleSelectRows.forEach((row, index) => {
    row.hidden = index >= count;
  });
  additionalPlayerMetrics.forEach((metric, index) => {
    metric.row.hidden = index + 1 >= count;
  });
  if (multiplayer) {
    primaryDriveGuide.innerHTML = "<b>P1 · WASD</b> accelerate, reverse and steer";
    primaryActionGuide.innerHTML = "<b>Space</b> handbrake · <b>Left Shift</b> brake · <b>R</b> recover · <b>E</b> item";
    secondaryDriveGuide.hidden = false;
    secondaryActionGuide.hidden = false;
  } else {
    primaryDriveGuide.innerHTML = "<b>WASD / arrows</b> accelerate, reverse and steer";
    primaryActionGuide.innerHTML = "<b>Space</b> handbrake · <b>Shift</b> brake · <b>R</b> recover · <b>E /</b> item";
    secondaryDriveGuide.hidden = true;
    secondaryActionGuide.hidden = true;
  }
  gamepadGuide.innerHTML = `<b>Gamepads 1–${count}</b> left stick · triggers · A/B/X/Y${count > 2 ? " · P3/P4 gamepad only" : ""}`;
  resetButton.textContent = multiplayer ? "Reset vehicles" : "Reset vehicle";
  runtimeShortcuts.textContent = multiplayer
    ? `P1 WASD + E · P2 arrows + / · ${count} gamepads · C colliders`
    : "E or / uses item · C colliders · R recovers";
}

function configureLocalRoster(): void {
  const grid = localRosterGrid();
  physics?.setVehicleRoster(grid.map((slot) => ({ id: slot.id, spawn: slot.spawn })));
  bindVehicleModels();
}

rebuildVehicleInputs();
applyRosterPresentation();

function applyState(next: RuntimeState): void {
  const matchActive = next === "race" || next === "paused";
  stateBadge.textContent = next;
  stateBadge.dataset["state"] = next;
  startButton.disabled = next !== "menu" && next !== "results";
  startButton.textContent = next === "results"
    ? "Race again"
    : trackDefinition ? "Start lap" : "Start simulation";
  pauseButton.disabled = !matchActive;
  pauseButton.textContent = next === "paused" ? "Resume" : "Pause";
  pauseButton.dataset["action"] = next === "paused" ? "resume" : "pause";
  finishButton.disabled = next !== "race";
  menuButton.disabled = !matchActive && next !== "results";
  resetButton.disabled = next === "paused";
  assetInput.disabled = next === "loading" || matchActive;
  playerCountSelect.disabled = next === "loading" || matchActive;
  vehicleSelects.forEach((select) => {
    select.disabled = next === "loading" || matchActive;
  });
  pauseOverlay.hidden = next !== "paused";
  applyCombatHud();
}

function formatRaceTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function applyEliminationWarning(): void {
  eliminationWarning.hidden = eliminationWarnings.length === 0;
  eliminationWarning.textContent = eliminationWarnings
    .map((warning) => `${LOCAL_PLAYER_SLOTS.find((slot) => slot.id === warning.playerId)?.label ?? warning.playerId} OUT · ${warning.secondsRemaining.toFixed(1)}s`)
    .join("   ");
}

function resetCameraElimination(): void {
  cameraElimination.reset();
  eliminationWarnings = [];
  applyEliminationWarning();
}

function applyRaceBanner(): void {
  const snapshot = raceSession?.snapshot;
  if (!snapshot || state.state === "menu" || snapshot.phase === "racing") {
    raceBanner.hidden = true;
    raceResults.hidden = true;
    return;
  }
  raceBanner.hidden = false;
  if (snapshot.phase === "countdown") {
    raceBannerLabel.textContent = "Get ready";
    raceBannerValue.textContent = String(Math.max(1, Math.ceil(snapshot.countdownSecondsRemaining)));
    raceResults.hidden = true;
    return;
  }

  const winner = snapshot.results[0];
  raceBannerLabel.textContent = winner?.status === "winner"
    ? "Last car standing"
    : winner?.status === "finished" ? `${winner.displayName} finished` : "Race over";
  raceBannerValue.textContent = winner?.status === "winner"
    ? `${winner.displayName} wins`
    : winner ? formatRaceTime(winner.timeSeconds) : "—";
  raceResults.replaceChildren(...snapshot.results.map((result) => {
    const item = document.createElement("li");
    const status = result.status === "winner"
      ? "WIN"
      : result.status === "finished" ? formatRaceTime(result.timeSeconds) : "OUT";
    item.innerHTML = `<span>${result.rank}</span><b>${result.displayName}</b><em>${status}</em>`;
    return item;
  }));
  raceResults.hidden = snapshot.results.length === 0;
}

function createTrackRaceSession(): RaceSession | undefined {
  return trackDefinition
    ? new RaceSession({
        course: trackDefinition,
        players: activePlayerSlots().map((slot) => ({ id: slot.id, displayName: slot.label })),
        totalLaps: 1,
        countdownSeconds: 3,
        finishWhenOnePlayerRemains: selectedPlayerCount() > 1,
      })
    : undefined;
}

function combatPickupDefinitions(): readonly CombatPickupDefinition[] {
  const weapons = ["machine-gun", "rocket", "mine"] as const;
  if (trackDefinition) {
    const checkpointIndices = [0.18, 0.48, 0.78].map((ratio) => (
      Math.min(trackDefinition!.checkpoints.length - 1, Math.floor(trackDefinition!.checkpoints.length * ratio))
    ));
    return weapons.map((weapon, index) => {
      const checkpoint = trackDefinition!.checkpoints[checkpointIndices[index] ?? 0]!;
      return {
        id: `pickup-${weapon}`,
        weapon,
        position: [checkpoint.center[0], checkpoint.center[1] + 0.8, checkpoint.center[2]],
      };
    });
  }
  return [
    { id: "pickup-machine-gun", weapon: "machine-gun", position: [-4, 0.7, -3] },
    { id: "pickup-rocket", weapon: "rocket", position: [-4, 0.7, 8] },
    { id: "pickup-mine", weapon: "mine", position: [-4, 0.7, 19] },
  ];
}

function createCombatSession(): CombatSession {
  return new CombatSession({
    players: activePlayerSlots().map((slot) => ({ id: slot.id, displayName: slot.label })),
    pickups: combatPickupDefinitions(),
  });
}

function applyCombatHud(): void {
  const snapshot = combatSession?.snapshot;
  combatHud.hidden = !snapshot || (state.state !== "race" && state.state !== "paused");
  combatPlayerRows.forEach((row, index) => {
    const player = snapshot?.players[index];
    row.hidden = !player;
    if (!player) {
      return;
    }
    const health = player.destroyed ? "DESTROYED" : `${Math.ceil(player.health)} HP`;
    const item = player.inventory
      ? `${player.inventory.weapon.replace("machine-gun", "MG")} ×${player.inventory.ammo}`
      : "EMPTY";
    row.dataset["destroyed"] = String(player.destroyed);
    row.replaceChildren();
    const label = document.createElement("b");
    label.textContent = player.displayName;
    const healthValue = document.createElement("span");
    healthValue.textContent = health;
    const itemValue = document.createElement("em");
    itemValue.textContent = item;
    row.append(label, healthValue, itemValue);
  });
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
        events.emit({ type: "audio:cue", cue: "race-start", gain: 0.08, sampleName: "go" });
        break;
      case "checkpoint-passed":
        runtimeStatus.textContent = `Checkpoint ${event.checkpointId} passed`;
        break;
      case "lap-completed":
        runtimeStatus.textContent = `Lap ${event.completedLaps} completed`;
        break;
      case "player-finished":
        physics?.deactivateVehicle(event.playerId);
        runtimeStatus.textContent = `${event.playerId} finished in ${formatRaceTime(event.timeSeconds)}`;
        break;
      case "player-won":
        physics?.deactivateVehicle(event.playerId);
        runtimeStatus.textContent = `${event.playerId} wins`;
        break;
      case "player-eliminated":
        physics?.deactivateVehicle(event.playerId);
        runtimeStatus.textContent = `${event.playerId} eliminated: ${event.reason}`;
        break;
      case "race-finished": {
        const winner = event.results[0];
        finishReason = winner?.status === "winner"
          ? `${winner.displayName} wins`
          : winner?.status === "finished"
            ? `${winner.displayName} finished in ${formatRaceTime(winner.timeSeconds)}`
          : "All players eliminated";
        break;
      }
    }
  }
  applyRaceBanner();
  return finishReason;
}

function handleCombatEvents(combatEvents: readonly CombatEvent[]): string | undefined {
  let finishReason: string | undefined;
  for (const event of combatEvents) {
    switch (event.type) {
      case "pickup-collected":
        runtimeStatus.textContent = `${event.playerId} picked up ${event.weapon} ×${event.ammo}`;
        events.emit({ type: "audio:cue", cue: "pickup", gain: 0.07, sampleName: "flash" });
        {
          const pickup = combatSession?.snapshot.pickups.find((candidate) => candidate.id === event.pickupId);
          if (pickup) {
            events.emit({
              type: "renderer:burst",
              position: pickup.position,
              color: COMBAT_EFFECT_COLORS[event.weapon],
              count: 14,
              durationSeconds: 0.45,
            });
          }
        }
        break;
      case "pickup-respawned":
        runtimeStatus.textContent = `${event.pickupId} respawned`;
        break;
      case "weapon-fired":
        events.emit({
          type: "audio:cue",
          cue: "weapon-fire",
          gain: 0.07,
          sampleName: event.weapon === "machine-gun"
            ? "machineg"
            : event.weapon === "rocket" ? "rocket" : "drop mine",
        });
        {
          const projectile = combatSession?.snapshot.projectiles.find((candidate) => (
            candidate.id === event.projectileId
          ));
          const position = projectile?.position
            ?? physics?.getVehicleTransformHistory(event.playerId)?.current.position;
          if (position) {
            events.emit({
              type: "renderer:burst",
              position,
              color: COMBAT_EFFECT_COLORS[event.weapon],
              count: event.weapon === "machine-gun" ? 5 : 9,
              durationSeconds: 0.24,
            });
          }
        }
        break;
      case "player-damaged":
        physics?.applyVehicleImpulse(event.playerId, event.knockbackImpulse);
        runtimeStatus.textContent = `${event.playerId} ${event.healthRemaining} HP`;
        events.emit({
          type: "audio:cue",
          cue: "impact",
          gain: 0.1,
          sampleName: event.weapon === "machine-gun" ? "bullethitscar" : "explosion1",
        });
        events.emit({ type: "renderer:flash", color: 0xff493d, durationSeconds: 0.12 });
        {
          const position = physics?.getVehicleTransformHistory(event.playerId)?.current.position;
          if (position) {
            events.emit({
              type: "renderer:burst",
              position,
              color: COMBAT_EFFECT_COLORS[event.weapon],
              count: 12,
              durationSeconds: 0.42,
            });
          }
        }
        break;
      case "player-destroyed": {
        events.emit({
          type: "audio:cue",
          cue: "vehicle-destroyed",
          gain: 0.16,
          sampleName: "explosion1",
        });
        const position = physics?.getVehicleTransformHistory(event.playerId)?.current.position;
        if (position) {
          events.emit({
            type: "renderer:burst",
            position,
            color: 0xff4c2f,
            count: 36,
            durationSeconds: 0.9,
          });
        }
        const raceEvents = raceSession?.eliminatePlayer(event.playerId, "destroyed") ?? [];
        if (!raceSession) {
          physics?.deactivateVehicle(event.playerId);
        }
        const eventFinishReason = handleRaceEvents(raceEvents);
        if (eventFinishReason) {
          finishReason = eventFinishReason;
        }
        break;
      }
      case "projectile-world-impact": {
        const explosive = event.weapon !== "machine-gun";
        const impulseMagnitude = explosive ? 12_000 : 2_400;
        if (event.objectId) {
          physics?.impactSceneObject(event.objectId, [
            -event.normal[0] * impulseMagnitude,
            Math.max(900, -event.normal[1] * impulseMagnitude),
            -event.normal[2] * impulseMagnitude,
          ], explosive);
        }
        runtimeStatus.textContent = event.objectId
          ? `${event.weapon} hit ${event.objectId}`
          : `${event.weapon} hit the course`;
        events.emit({
          type: "audio:cue",
          cue: "impact",
          gain: explosive ? 0.15 : 0.07,
          sampleName: explosive ? "explosion1" : "impact with barrier",
        });
        events.emit({
          type: "renderer:burst",
          position: event.position,
          color: COMBAT_EFFECT_COLORS[event.weapon],
          count: explosive ? 30 : 8,
          durationSeconds: explosive ? 0.8 : 0.3,
        });
        break;
      }
      case "projectile-expired":
        break;
    }
  }
  applyCombatHud();
  return finishReason;
}

events.subscribe((event) => {
  if (event.type === "runtime:state-changed") {
    applyState(event.to);
    runtimeStatus.textContent = event.reason;
  } else if (event.type === "simulation:overrun") {
    totalDroppedSeconds += event.droppedSeconds;
  } else if (event.type === "physics:object-destroyed") {
    events.emit({
      type: "renderer:burst",
      position: event.position,
      color: 0xffcf4a,
      count: 22,
      durationSeconds: 0.7,
    });
  }
});
applyState(state.state);

async function startRace(): Promise<void> {
  if (!physics || (state.state !== "menu" && state.state !== "results")) {
    return;
  }
  await audio.unlock();
  physics.resetDemo();
  resetCameraElimination();
  raceSession = createTrackRaceSession();
  combatSession = createCombatSession();
  latestVehicleInputs = {};
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
function pauseRace(reason = "Match paused"): void {
  if (state.state !== "race") {
    return;
  }
  state.transition("paused", reason);
  clock.reset(performance.now() / 1000);
  events.emit({ type: "audio:cue", cue: "pause", gain: 0.055 });
}

function resumeRace(): void {
  if (state.state !== "paused") {
    return;
  }
  void audio.unlock();
  clock.reset(performance.now() / 1000);
  state.transition("race", "Match resumed");
  events.emit({ type: "audio:cue", cue: "resume", gain: 0.055 });
}

pauseButton.addEventListener("click", () => {
  if (state.state === "paused") {
    resumeRace();
  } else {
    pauseRace();
  }
});
finishButton.addEventListener("click", () => {
  if (state.state === "race") {
    raceSession = undefined;
    combatSession = undefined;
    latestVehicleInputs = {};
    resetCameraElimination();
    state.transition("results", "Simulation completed without clock drift");
    applyRaceBanner();
    events.emit({ type: "audio:cue", cue: "race-finish", gain: 0.08 });
  }
});
menuButton.addEventListener("click", () => {
  if (state.state === "race" || state.state === "paused" || state.state === "results") {
    raceSession = undefined;
    combatSession = undefined;
    latestVehicleInputs = {};
    resetCameraElimination();
    state.transition("menu", "Runtime ready");
    applyRaceBanner();
    events.emit({ type: "audio:cue", cue: "menu", gain: 0.05 });
  }
});
resetButton.addEventListener("click", () => {
  physics?.resetDemo();
  resetCameraElimination();
  raceSession = state.state === "race" ? createTrackRaceSession() : undefined;
  combatSession = state.state === "race" ? createCombatSession() : undefined;
  latestVehicleInputs = {};
  applyRaceBanner();
  applyCombatHud();
});
debugCamera.addEventListener("change", () => renderer.setDebugCamera(debugCamera.checked));
playerCountSelect.addEventListener("change", () => {
  raceSession = undefined;
  combatSession = undefined;
  latestVehicleInputs = {};
  resetCameraElimination();
  rebuildVehicleInputs();
  applyRosterPresentation();
  configureLocalRoster();
  applyState(state.state);
  runtimeStatus.textContent = `${selectedPlayerCount()} local player${selectedPlayerCount() === 1 ? "" : "s"} ready`;
});
vehicleSelects.forEach((select) => {
  select.addEventListener("change", () => {
    const bound = bindVehicleModels();
    runtimeStatus.textContent = bound.length > 0
      ? `${bound.length} original vehicle model${bound.length === 1 ? "" : "s"} bound`
      : "Debug vehicle proxies selected";
  });
});

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

function vehiclePairKey(pair: VehicleAssetPair): string {
  return pair.fileName.toLocaleLowerCase("en-US");
}

function refreshVehicleCatalog(): void {
  vehicleCatalog = listVehicleAssetPairs(loadedDffs.keys(), loadedTextureDictionaries.keys());
  const availableKeys = new Set(vehicleCatalog.map(vehiclePairKey));
  vehicleSelects.forEach((select, index) => {
    const previousValue = select.value;
    const proxy = document.createElement("option");
    proxy.value = "";
    proxy.textContent = "Debug proxy";
    const options = vehicleCatalog.map((pair) => {
      const option = document.createElement("option");
      option.value = vehiclePairKey(pair);
      option.textContent = `${pair.vehicleName} · skin ${pair.variant}`;
      return option;
    });
    select.replaceChildren(proxy, ...options);
    const defaultPair = vehicleCatalog[index % Math.max(1, vehicleCatalog.length)];
    select.value = availableKeys.has(previousValue)
      ? previousValue
      : defaultPair ? vehiclePairKey(defaultPair) : "";
  });
}

function bindVehicleModels(): string[] {
  const bound: string[] = [];
  const activeIds = new Set(activePlayerSlots().map((slot) => slot.id));
  LOCAL_PLAYER_SLOTS.forEach((slot, index) => {
    const selectedKey = vehicleSelects[index]!.value;
    const pair = vehicleCatalog.find((candidate) => vehiclePairKey(candidate) === selectedKey);
    if (!activeIds.has(slot.id) || !pair) {
      renderer.clearVehicleModelFor(slot.id);
      return;
    }
    const model = loadedDffs.get(pair.fileName.toLocaleLowerCase("en-US"));
    const textures = loadedTextureDictionaries.get(pair.textureFileName.toLocaleLowerCase("en-US"));
    if (!model || !textures) {
      renderer.clearVehicleModelFor(slot.id);
      return;
    }
    const rendered = renderer.setVehicleModelFor(slot.id, model, textures);
    bound.push(
      `${slot.label} ${pair.vehicleName} skin ${pair.variant} · ${rendered.atomics} atomics · ${rendered.triangles.toLocaleString()} tris${rendered.missingTextureNames.length > 0 ? ` · ${rendered.missingTextureNames.length} missing maps` : ""}`,
    );
  });
  return bound;
}

function bindTrackParts(): string[] {
  const bound: string[] = [];
  if (trackParts.ai && trackParts.lapData && physics) {
    trackDefinition = deriveTrackDefinition(trackParts.ai, trackParts.lapData);
    configureLocalRoster();
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
  refreshVehicleCatalog();
  const vehicles = bindVehicleModels();
  if (vehicles.length > 0) {
    bound.push(`vehicles ${vehicles.join(" · ")}`);
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
    combatSession = undefined;
    latestVehicleInputs = {};
    applyRaceBanner();
    applyCombatHud();
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
        } else if (result.asset.kind === "rws") {
          const accepted = audio.addSampleBank(result.asset.data.sounds);
          role = `${accepted} PCM samples accepted · ${audio.originalSampleCount} total ready`;
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

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseRace("Paused while the tab was hidden");
  }
  resetPresentationClock();
});
window.addEventListener("blur", () => {
  pauseRace("Paused after focus loss");
  resetPresentationClock();
});
window.addEventListener("focus", resetPresentationClock);
window.addEventListener("resize", () => renderer.resize(viewport.clientWidth, viewport.clientHeight));
window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && (state.state === "race" || state.state === "paused")) {
    event.preventDefault();
    if (state.state === "paused") {
      resumeRace();
    } else {
      pauseRace();
    }
  } else if (event.code === "KeyC") {
    debugColliders.checked = !debugColliders.checked;
  }
});

function currentRacePositions(): Readonly<Record<string, readonly [number, number, number]>> {
  const positions: Record<string, readonly [number, number, number]> = {};
  if (!physics) {
    return positions;
  }
  for (const slot of activePlayerSlots()) {
    const history = physics.getVehicleTransformHistory(slot.id);
    if (history) {
      positions[slot.id] = history.current.position;
    }
  }
  return positions;
}

function currentCombatPlayerFrames(): CombatPlayerFrames {
  const frames: Record<string, { position: readonly [number, number, number]; headingRadians: number }> = {};
  if (!physics) {
    return frames;
  }
  const activeIds = new Set(physics.activeVehicleIds);
  for (const slot of activePlayerSlots()) {
    if (!activeIds.has(slot.id)) {
      continue;
    }
    const history = physics.getVehicleTransformHistory(slot.id);
    const telemetry = physics.getVehicleTelemetry(slot.id);
    if (history && telemetry) {
      frames[slot.id] = {
        position: history.current.position,
        headingRadians: telemetry.headingRadians,
      };
    }
  }
  return frames;
}

function updateCameraEliminations(
  stepSeconds: number,
  positions: Readonly<Record<string, readonly [number, number, number]>>,
): string | undefined {
  if (!physics || !raceSession || !trackDefinition || raceSession.phase !== "racing") {
    eliminationWarnings = [];
    applyEliminationWarning();
    return undefined;
  }
  const subjects = raceSession.snapshot.players.flatMap((player) => {
    const position = positions[player.id];
    const nextCheckpoint = trackDefinition?.checkpoints.find((checkpoint) => (
      checkpoint.id === player.progress.nextCheckpointId
    ));
    if (player.status !== "racing" || !position || !nextCheckpoint) {
      return [];
    }
    return [{
      id: player.id,
      position,
      completedLaps: player.progress.completedLaps,
      passedCheckpoints: player.progress.passedCheckpoints,
      distanceToNextCheckpointMeters: Math.hypot(
        position[0] - nextCheckpoint.center[0],
        position[1] - nextCheckpoint.center[1],
        position[2] - nextCheckpoint.center[2],
      ),
    }];
  });
  const update = cameraElimination.update(stepSeconds, subjects);
  eliminationWarnings = update.warnings;
  applyEliminationWarning();
  let finishReason: string | undefined;
  for (const playerId of update.eliminatedPlayerIds) {
    const eventReason = handleRaceEvents(raceSession.eliminatePlayer(playerId, "camera-distance"));
    if (eventReason) {
      finishReason = eventReason;
    }
  }
  return finishReason;
}

function sampleVehicleInputs(gamepads: readonly (Gamepad | null)[]): VehicleInputById {
  const sampled: Record<string, VehicleInputFrame> = {};
  const racePlayers = new Map(raceSession?.snapshot.players.map((player) => [player.id, player.status]));
  activePlayerSlots().forEach((slot, index) => {
    const canDrive = !raceSession || (
      raceSession.phase === "racing" && racePlayers.get(slot.id) === "racing"
    );
    sampled[slot.id] = canDrive
      ? vehicleInputs[index]?.sample(gamepads) ?? NEUTRAL_VEHICLE_INPUT
      : NEUTRAL_VEHICLE_INPUT;
  });
  return sampled;
}

function updateEngineAudio(): void {
  if (!physics || (state.state !== "race" && state.state !== "paused")) {
    audio.setEngineVoices([]);
    return;
  }
  const activeIds = new Set(physics.activeVehicleIds);
  audio.setEngineVoices(activePlayerSlots().flatMap((slot) => {
    const telemetry = physics?.getVehicleTelemetry(slot.id);
    if (!activeIds.has(slot.id) || !telemetry) {
      return [];
    }
    return [{
      id: slot.id,
      normalizedSpeed: Math.min(
        1,
        telemetry.speedMetersPerSecond / DEFAULT_VEHICLE_CONFIG.drive.maxForwardSpeed,
      ),
      throttle: Math.abs(latestVehicleInputs[slot.id]?.drive ?? 0),
    }];
  }));
}

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
      const positions = currentRacePositions();
      const raceEvents = raceSession?.advance(stepSeconds, positions) ?? [];
      const eventFinishReason = handleRaceEvents(raceEvents);
      if (eventFinishReason) {
        raceFinishReason = eventFinishReason;
      }
      const eliminationFinishReason = updateCameraEliminations(stepSeconds, positions);
      if (eliminationFinishReason) {
        raceFinishReason = eliminationFinishReason;
      }
      const sampledInputs = sampleVehicleInputs(gamepads);
      latestVehicleInputs = sampledInputs;
      if (combatSession && (!raceSession || raceSession.phase === "racing")) {
        const useRequests = Object.fromEntries(Object.entries(sampledInputs).map(([id, input]) => (
          [id, Boolean(input.useItem)]
        )));
        const combatFinishReason = handleCombatEvents(combatSession.advance(
          stepSeconds,
          currentCombatPlayerFrames(),
          useRequests,
          (segment) => physics?.castProjectileSegment(segment.start, segment.end),
        ));
        if (combatFinishReason) {
          raceFinishReason = combatFinishReason;
        }
      }
      physics?.stepVehicles(stepSeconds, sampledInputs);
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
    primaryVehicleActive: physics.activeVehicleIds.includes(PRIMARY_VEHICLE_ID),
    ...(combatSession ? { combat: combatSession.snapshot } : {}),
    interpolationAlpha: frame.interpolationAlpha,
    frameDeltaSeconds: renderDeltaSeconds,
    ...(debugColliders.checked ? { debugLines: physics.debugLines() } : {}),
  });
  updateEngineAudio();

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
    const primaryTelemetry = physics.getVehicleTelemetry(PRIMARY_VEHICLE_ID);
    metricSpeed.textContent = primaryTelemetry
      ? `${(primaryTelemetry.speedMetersPerSecond * 3.6).toFixed(0)} km/h`
      : "inactive";
    metricWheels.textContent = primaryTelemetry ? `${primaryTelemetry.groundedWheels} / 4` : "—";
    metricSurface.textContent = primaryTelemetry?.surface ?? "inactive";
    additionalPlayerMetrics.forEach((metric, index) => {
      const slot = LOCAL_PLAYER_SLOTS[index + 1];
      const telemetry = slot ? physics?.getVehicleTelemetry(slot.id) : undefined;
      metric.value.textContent = telemetry
        ? `${(telemetry.speedMetersPerSecond * 3.6).toFixed(0)} km/h · ${telemetry.groundedWheels}/4 · ${telemetry.surface}`
        : "inactive";
    });
    metricObjects.textContent = `${physicsMetrics.activeObjects} / ${physicsMetrics.destroyedObjects}`;
    metricTrack.textContent = physicsMetrics.trackTriangles.toLocaleString();
    const raceSnapshot = raceSession?.snapshot;
    const playerRace = raceSnapshot?.players[0];
    const lapProgress = playerRace?.progress;
    metricLap.textContent = lapProgress && raceSnapshot
      ? `${Math.min(lapProgress.completedLaps + (playerRace.status === "finished" || playerRace.status === "winner" ? 0 : 1), raceSnapshot.totalLaps)} / ${raceSnapshot.totalLaps}`
      : "—";
    metricCheckpoint.textContent = lapProgress
      ? playerRace.status === "finished" || playerRace.status === "winner"
        ? `${lapProgress.totalCheckpoints} / ${lapProgress.totalCheckpoints} ✓`
        : `${lapProgress.passedCheckpoints} / ${lapProgress.totalCheckpoints} → ${lapProgress.nextCheckpointId}`
      : "—";
    applyCombatHud();
    lastOverlayUpdate = timestampMilliseconds;
  }
  animationFrame = requestAnimationFrame(renderFrame);
}

async function boot(): Promise<void> {
  state.transition("loading", "Loading Rapier WebAssembly…");
  try {
    physics = await createPhysicsRuntime(events, STEP_SECONDS, undefined, selectedPhysicsOptions());
    configureLocalRoster();
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
  vehicleInputs.forEach((input) => input.dispose());
  physics?.dispose();
  renderer.dispose();
  void audio.dispose();
}, { once: true });

void boot();
