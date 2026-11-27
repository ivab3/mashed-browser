import { ContentStore, readCachedContentFile, type StoredContent } from "./content-store.js";
import { importGameSource } from "./import-client.js";
import { prepareOfflineLaunch } from "./offline-launch.js";
import { AudioRuntime } from "@mashed/audio";
import {
  admittedTrackByCourseId,
  admittedVehicleByAssetName,
  deriveTrackDefinition,
  listVehicleAssetPairs,
  parseAiData,
  parseLedData,
  parsePowerupPlacementsLua,
  parseTrackPowerupLoadoutsLua,
  parseCourseLua,
  parseLapDataLua,
  type AiDataFile,
  type BspWorld,
  type CourseDefinition,
  type DerivedTrackDefinition,
  type DffModel,
  type LapDataDefinition,
  type LedDataFile,
  type OriginalPowerupPlacement,
  type OriginalPowerupType,
  type PiTextureDictionary,
  type TrackPowerupLoadout,
  type VehicleAssetPair,
} from "@mashed/assets";
import {
  AiRouteDriver,
  CameraEliminationTracker,
  ChampionshipSession,
  CombatSession,
  createAlphaChampionshipDefinition,
  createAlphaMatchOptions,
  createLocalPlayerGrid,
  FixedStepClock,
  LOCAL_PLAYER_SLOTS,
  MatchModeSession,
  RaceSession,
  rankChampionshipEvent,
  RuntimeEventBus,
  RuntimeStateMachine,
  type AiDifficulty,
  type ChampionshipDefinition,
  type ChampionshipSaveV1,
  type FixedStepFrame,
  type CameraEliminationWarning,
  type CombatEvent,
  type CombatPickupDefinition,
  type CombatPlayerFrames,
  type CombatWeaponType,
  type LocalPlayerGridSlot,
  type MatchModeEvent,
  type MatchModeType,
  type RaceEvent,
  type RuntimeState,
} from "@mashed/core";
import {
  BrowserVehicleInput,
  GAMEPAD_ONLY_KEYBOARD_BINDINGS,
  isInteractiveKeyboardTarget,
  NEUTRAL_VEHICLE_INPUT,
  PLAYER_TWO_KEYBOARD_BINDINGS,
  type VehicleKeyboardBindings,
  type VehicleInputFrame,
} from "@mashed/input";
import {
  createPhysicsRuntime,
  DEFAULT_VEHICLE_CONFIG,
  deriveRouteCollisionLayers,
  PRIMARY_VEHICLE_ID,
  probeAiNavigation,
  TrackHazardRuntime,
  type PhysicsRuntime,
  type PhysicsRuntimeOptions,
  type VehicleInputById,
} from "@mashed/physics";
import { RuntimeRenderer } from "@mashed/renderer";

import { AssetLoadingClient } from "./asset-loader.js";
import { TrackHazardAssets } from "./track-hazard-assets.js";
import {
  AlphaSettingsStorage,
  DEFAULT_ALPHA_SETTINGS,
  type AlphaSettingsV1,
} from "./alpha-settings.js";
import { ChampionshipSaveStorage } from "./championship-storage.js";
import {
  CONTROL_BINDING_ACTIONS,
  ControlBindingsStorage,
  DEFAULT_CONTROL_BINDINGS,
  formatKeyboardCode,
  isRebindableKeyboardCode,
  rebindControlAction,
  vehicleKeyboardBindings,
  type ControlBindingAction,
  type ControlBindingsV1,
} from "./control-bindings.js";
import type { LoadedAsset } from "./loading-protocol.js";
import type {
  LocalContentCatalog,
  LocalContentFile,
  LocalTrackCatalogEntry,
  LocalVehicleCatalogEntry,
} from "./local-content-catalog.js";
import {
  evaluateM1Evidence,
  M1EvidenceCollector,
  type M1EvidenceReport,
} from "./m1-evidence.js";
import { courseModelNames, playableTrackFiles, trackBspRole, type TrackBspRole } from "./track-resource-role.js";
import "./style.css";

function element<T extends HTMLElement>(id: string): T {
  const result = document.querySelector<T>(`#${id}`);
  if (!result) {
    throw new Error(`Missing #${id}`);
  }
  return result;
}

function assetSummary(asset: LoadedAsset): string {
  switch (asset.kind) {
    case "mts":
      return `${asset.data.matrices.length} instance matrices`;
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
const COMBAT_EFFECT_COLORS: Readonly<Record<CombatWeaponType, number>> = Object.freeze({
  "machine-gun": 0xffcf4a,
  "guided-missile": 0xff654f,
  mortar: 0xff9f43,
  "rear-flame": 0xff6a22,
  oil: 0x242a32,
  "proximity-mine": 0x8d6be8,
  "drum-bomb": 0xc44735,
  shotgun: 0x77d9ff,
  flash: 0xffffff,
  rocket: 0xff654f,
  mine: 0x8d6be8,
});
const searchParameters = new URLSearchParams(window.location.search);
const vehiclePairLab = searchParameters.get("collisionLab") === "vehicle-pair";
const m1EvidenceMode = searchParameters.get("m1Evidence") === "1";
if (m1EvidenceMode) {
  document.documentElement.dataset["m1Evidence"] = "true";
}

function selectedPhysicsOptions(): PhysicsRuntimeOptions {
  return vehiclePairLab ? { collisionObjects: false } : {};
}

const viewport = element<HTMLElement>("viewport");
const stateBadge = element<HTMLElement>("state-badge");
const runtimeStatus = element<HTMLElement>("runtime-status");
const assetStatus = element<HTMLElement>("asset-status");
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
const metricHazards = element<HTMLElement>("metric-hazards");
const metricTrack = element<HTMLElement>("metric-track");
const metricLap = element<HTMLElement>("metric-lap");
const metricCheckpoint = element<HTMLElement>("metric-checkpoint");
const raceBanner = element<HTMLElement>("race-banner");
const raceBannerLabel = element<HTMLElement>("race-banner-label");
const raceBannerValue = element<HTMLElement>("race-banner-value");
const raceResults = element<HTMLOListElement>("race-results");
const eliminationWarning = element<HTMLElement>("elimination-warning");
const pauseOverlay = element<HTMLElement>("pause-overlay");
const m1EvidencePanel = element<HTMLElement>("m1-evidence-panel");
const m1EvidenceLoad = element<HTMLButtonElement>("m1-evidence-load");
const m1EvidenceReset = element<HTMLButtonElement>("m1-evidence-reset");
const m1EvidenceCapture = element<HTMLButtonElement>("m1-evidence-capture");
const m1EvidenceOutput = element<HTMLElement>("m1-evidence-output");
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
const gameFlowSelect = element<HTMLSelectElement>("game-flow");
const matchModeRow = element<HTMLElement>("match-mode-row");
const matchModeSelect = element<HTMLSelectElement>("match-mode");
const modeHud = element<HTMLElement>("mode-hud");
const modeHudTitle = element<HTMLElement>("mode-hud-title");
const modeHudObjective = element<HTMLElement>("mode-hud-objective");
const modeHudScores = element<HTMLOListElement>("mode-hud-scores");
const championshipHud = element<HTMLElement>("championship-hud");
const championshipHudTitle = element<HTMLElement>("championship-hud-title");
const championshipHudEvent = element<HTMLElement>("championship-hud-event");
const championshipHudStandings = element<HTMLOListElement>("championship-hud-standings");
const localContentCount = element<HTMLElement>("local-content-count");
const localContentStatus = element<HTMLElement>("local-content-status");
const importFolderButton = element<HTMLButtonElement>("import-folder");
const importDiscButton = element<HTMLButtonElement>("import-disc");
const importDiscInput = element<HTMLInputElement>("import-disc-input");
const importFolderInput = element<HTMLInputElement>("import-folder-input");
const importCancelButton = element<HTMLButtonElement>("import-cancel");
const importProgress = element<HTMLProgressElement>("import-progress");
const importStatus = element<HTMLElement>("import-status");
const trackSelect = element<HTMLButtonElement>("track-select");
const trackSelectImage = element<HTMLImageElement>("track-select-image");
const trackSelectName = element<HTMLElement>("track-select-name");
const trackSelectDetail = element<HTMLElement>("track-select-detail");
const contentCatalogDialog = element<HTMLDialogElement>("content-catalog");
const contentCatalogKicker = element<HTMLElement>("content-catalog-kicker");
const contentCatalogTitle = element<HTMLElement>("content-catalog-title");
const contentCatalogDescription = element<HTMLElement>("content-catalog-description");
const contentCatalogGrid = element<HTMLElement>("content-catalog-grid");
const contentCatalogFooter = element<HTMLElement>("content-catalog-footer");
const vehicleVariantList = element<HTMLElement>("vehicle-variant-list");
const vehicleCatalogConfirm = element<HTMLButtonElement>("vehicle-catalog-confirm");
const vehicleSelectRows = [
  element<HTMLElement>("vehicle-select-row-one"),
  element<HTMLElement>("vehicle-select-row-two"),
  element<HTMLElement>("vehicle-select-row-three"),
  element<HTMLElement>("vehicle-select-row-four"),
];
const vehicleSelects = [
  element<HTMLButtonElement>("vehicle-select-one"),
  element<HTMLButtonElement>("vehicle-select-two"),
  element<HTMLButtonElement>("vehicle-select-three"),
  element<HTMLButtonElement>("vehicle-select-four"),
];
const driverSelectRows = [
  element<HTMLElement>("driver-select-row-one"),
  element<HTMLElement>("driver-select-row-two"),
  element<HTMLElement>("driver-select-row-three"),
  element<HTMLElement>("driver-select-row-four"),
];
const driverSelects = [
  element<HTMLSelectElement>("driver-select-one"),
  element<HTMLSelectElement>("driver-select-two"),
  element<HTMLSelectElement>("driver-select-three"),
  element<HTMLSelectElement>("driver-select-four"),
];
const settingsDifficulty = element<HTMLSelectElement>("settings-difficulty");
const settingsGraphics = element<HTMLSelectElement>("settings-graphics");
const settingsVolume = element<HTMLInputElement>("settings-volume");
const settingsVolumeValue = element<HTMLOutputElement>("settings-volume-value");
const settingsDeadzone = element<HTMLInputElement>("settings-deadzone");
const settingsDeadzoneValue = element<HTMLOutputElement>("settings-deadzone-value");
const settingsMuted = element<HTMLInputElement>("settings-muted");
const settingsReset = element<HTMLButtonElement>("settings-reset");
const settingsStatus = element<HTMLElement>("settings-status");
const settingsBindingsStatus = element<HTMLElement>("settings-bindings-status");
const bindingButtons: Readonly<Record<ControlBindingAction, HTMLButtonElement>> = {
  forward: element<HTMLButtonElement>("binding-forward"),
  reverse: element<HTMLButtonElement>("binding-reverse"),
  left: element<HTMLButtonElement>("binding-left"),
  right: element<HTMLButtonElement>("binding-right"),
  brake: element<HTMLButtonElement>("binding-brake"),
  handbrake: element<HTMLButtonElement>("binding-handbrake"),
  recover: element<HTMLButtonElement>("binding-recover"),
  useItem: element<HTMLButtonElement>("binding-use-item"),
};
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
const championshipStorage = new ChampionshipSaveStorage(() => window.localStorage);
const settingsStorage = new AlphaSettingsStorage(() => window.localStorage);
const settingsLoad = settingsStorage.load();
let alphaSettings = settingsLoad.settings;
const controlBindingsStorage = new ControlBindingsStorage(() => window.localStorage);
const controlBindingsLoad = controlBindingsStorage.load();
let controlBindings: ControlBindingsV1 = controlBindingsLoad.bindings;
audio.setMasterVolume(alphaSettings.muted ? 0 : alphaSettings.masterVolume);
renderer.setGraphicsQuality(alphaSettings.graphicsQuality);
const trackAssets = new Map<string, LoadedAsset>();
const trackHazardAssets = new TrackHazardAssets();
let trackHazards: TrackHazardRuntime | undefined;
const trackParts: {
  ai?: BspWorld;
  collision?: BspWorld;
  graphics?: BspWorld;
  lapData?: LapDataDefinition;
  course?: CourseDefinition;
  powerupPlacements?: readonly OriginalPowerupPlacement[];
  powerupLoadouts?: readonly TrackPowerupLoadout[];
  sourceAi?: AiDataFile;
  sourceLed?: LedDataFile;
} = {};
const vehicleModels = new Map<string, DffModel>();
const vehicleTextures = new Map<string, PiTextureDictionary>();
let physics: PhysicsRuntime | undefined;
let trackDefinition: DerivedTrackDefinition | undefined;
let raceSession: RaceSession | undefined;
let combatSession: CombatSession | undefined;
let matchModeSession: MatchModeSession | undefined;
let matchModeSignature: string | undefined;
let championshipSession: ChampionshipSession | undefined;
let roundEliminationOrder: string[] = [];
let flagPosition: readonly [number, number, number] = [-4, 0.8, 8];
let fugitiveInterceptorId: string | undefined;
const cameraElimination = new CameraEliminationTracker();
let eliminationWarnings: readonly CameraEliminationWarning[] = [];
let vehicleInputs: BrowserVehicleInput[] = [];
let aiDrivers = new Map<string, AiRouteDriver>();
let latestVehicleInputs: VehicleInputById = {};
let vehicleCatalog: readonly VehicleAssetPair[] = [];
let localContentCatalog: LocalContentCatalog | undefined;
let storedContent: StoredContent | undefined;
let contentCatalogInitializing = true;
let offlineShellReady = false;

function showOfflineReadiness(): void {
  if (!offlineShellReady || contentCatalogInitializing) return;
  element<HTMLElement>("offline-status").textContent = storedContent
    ? "Ready to play offline."
    : "Game cached. Import your library to play offline.";
}
let cancelContentImport: (() => void) | undefined;
let localPreviewImages = new Map<string, string>();
let selectedTrack: LocalTrackCatalogEntry | undefined;
let sharedBankLoad: Promise<void> | undefined;
let vehicleCatalogTarget = 0;
let pendingVehicleCatalogId: string | undefined;
let pendingVehicleVariant = 0;
let animationFrame = 0;
let lastRenderTimestamp: number | undefined;
let smoothedFps = 60;
let lastOverlayUpdate = 0;
let physicsMilliseconds = 0;
let totalDroppedSeconds = 0;
let pendingBindingAction: ControlBindingAction | undefined;
const m1Evidence = new M1EvidenceCollector();

playerCountSelect.value = m1EvidenceMode ? "4" : vehiclePairLab ? "2" : "1";

declare global {
  interface Window {
    __MASHED_M1_EVIDENCE__?: {
      readonly version: 1;
      readonly mode: true;
      reset(): void;
      report(): M1EvidenceReport;
    };
  }
}

if (m1EvidenceMode) {
  m1EvidencePanel.hidden = false;
}

function selectedPlayerCount(): number {
  const value = Number(playerCountSelect.value);
  return Number.isInteger(value) && value >= 1 && value <= LOCAL_PLAYER_SLOTS.length ? value : 1;
}

function selectedGameFlow(): "single" | "championship" {
  return gameFlowSelect.value === "championship" ? "championship" : "single";
}

const MATCH_MODE_LABELS: Readonly<Record<MatchModeType, string>> = Object.freeze({
  standard: "Standard Play",
  team: "Team Play",
  "hold-the-flag": "Hold the Flag",
  fugitive: "The Fugitive",
});

function selectedMatchMode(): MatchModeType {
  if (selectedGameFlow() === "championship" && championshipSession) {
    return championshipSession.snapshot.currentEvent.mode;
  }
  const value = matchModeSelect.value;
  return value === "team" || value === "hold-the-flag" || value === "fugitive"
    ? value
    : "standard";
}

function selectedAiDifficulty(index: number): AiDifficulty | undefined {
  const value = driverSelects[index]?.value;
  return value === "easy" || value === "normal" || value === "hard" ? value : undefined;
}

function syncAlphaSettingsControls(): void {
  settingsDifficulty.value = alphaSettings.difficulty;
  settingsGraphics.value = alphaSettings.graphicsQuality;
  settingsVolume.value = String(Math.round(alphaSettings.masterVolume * 100));
  settingsVolumeValue.value = `${Math.round(alphaSettings.masterVolume * 100)}%`;
  settingsDeadzone.value = String(Math.round(alphaSettings.gamepadDeadzone * 100));
  settingsDeadzoneValue.value = `${Math.round(alphaSettings.gamepadDeadzone * 100)}%`;
  settingsMuted.checked = alphaSettings.muted;
  settingsVolume.disabled = alphaSettings.muted;
}

const CONTROL_BINDING_LABELS: Readonly<Record<ControlBindingAction, string>> = Object.freeze({
  forward: "accelerate",
  reverse: "reverse",
  left: "steer left",
  right: "steer right",
  brake: "brake",
  handbrake: "handbrake",
  recover: "recover",
  useItem: "use item",
});

function syncControlBindingButtons(): void {
  for (const action of CONTROL_BINDING_ACTIONS) {
    const button = bindingButtons[action];
    const capturing = action === pendingBindingAction;
    const keyLabel = formatKeyboardCode(controlBindings.playerOne[action]);
    button.textContent = capturing ? "Press key…" : keyLabel;
    button.dataset["capturing"] = String(capturing);
    button.setAttribute(
      "aria-label",
      capturing
        ? `Waiting to rebind ${CONTROL_BINDING_LABELS[action]}`
        : `Rebind ${CONTROL_BINDING_LABELS[action]} (${keyLabel})`,
    );
  }
}

function persistControlBindings(status: string): void {
  const result = controlBindingsStorage.save(controlBindings);
  settingsBindingsStatus.textContent = result.ok
    ? `${status} · saved locally`
    : `${status} · save unavailable: ${result.error}`;
}

function persistAlphaSettings(status: string): void {
  const result = settingsStorage.save(alphaSettings);
  settingsStatus.textContent = result.ok ? `${status} · saved locally` : `${status} · save unavailable: ${result.error}`;
}

function applyAlphaSettings(
  next: AlphaSettingsV1,
  status: string,
  options: { rebuildInputs?: boolean; syncCpuDrivers?: boolean } = {},
): void {
  alphaSettings = next;
  if (options.syncCpuDrivers) {
    driverSelects.forEach((select) => {
      if (select.value !== "human") {
        select.value = alphaSettings.difficulty;
      }
    });
    aiDrivers.clear();
    matchModeSession = undefined;
    matchModeSignature = undefined;
  }
  const wasSilent = audio.masterVolume === 0;
  audio.setMasterVolume(alphaSettings.muted ? 0 : alphaSettings.masterVolume);
  if (wasSilent && (state.state === "race" || state.state === "paused")) {
    void prepareRaceAudio();
  }
  renderer.setGraphicsQuality(alphaSettings.graphicsQuality);
  syncAlphaSettingsControls();
  if (options.rebuildInputs) {
    rebuildVehicleInputs();
  }
  applyRosterPresentation();
  persistAlphaSettings(status);
}

function currentMatchModeSignature(): string {
  const championshipEvent = championshipSession?.snapshot.currentEvent.id ?? "none";
  return `${selectedGameFlow()}:${championshipEvent}:${selectedPlayerCount()}:${selectedMatchMode()}:${driverSelects
    .slice(0, selectedPlayerCount())
    .map((select) => select.value)
    .join(",")}`;
}

function defaultFlagPosition(): readonly [number, number, number] {
  const checkpoint = trackDefinition?.checkpoints[Math.floor((trackDefinition?.checkpoints.length ?? 1) / 2)];
  return checkpoint
    ? [checkpoint.center[0], checkpoint.center[1] + 0.9, checkpoint.center[2]]
    : [-4, 0.8, 8];
}

function createMatchModeSession(): MatchModeSession | undefined {
  if (selectedPlayerCount() < 2) {
    return undefined;
  }
  return new MatchModeSession(createAlphaMatchOptions(
    selectedMatchMode(),
    activePlayerSlots().map((slot) => ({ id: slot.id, displayName: slot.label })),
    championshipSession !== undefined,
  ));
}

function alphaChampionshipDefinition(): ChampionshipDefinition {
  const courseId = trackParts.course?.id;
  const courseLabel = courseId === undefined
    ? "Loaded Track"
    : admittedTrackByCourseId(courseId)?.displayName ?? `Course ${courseId}`;
  return createAlphaChampionshipDefinition(selectedPlayerCount(), courseId, courseLabel);
}

function persistChampionship(): string | undefined {
  if (!championshipSession) {
    return undefined;
  }
  const result = championshipStorage.save(championshipSession.save());
  return result.ok ? undefined : `Championship save unavailable: ${result.error}`;
}

function syncChampionshipEventMode(): void {
  if (!championshipSession) {
    return;
  }
  matchModeSelect.value = championshipSession.snapshot.currentEvent.mode;
}

function prepareChampionshipSession(): string {
  if (selectedGameFlow() !== "championship") {
    championshipSession = undefined;
    return "Single match selected";
  }
  const definition = alphaChampionshipDefinition();
  const loaded = championshipStorage.load(definition.id);
  let resumed = false;
  if (loaded.ok && loaded.save !== undefined) {
    try {
      championshipSession = ChampionshipSession.restore(
        definition,
        loaded.save as ChampionshipSaveV1,
      );
      resumed = true;
    } catch {
      championshipSession = new ChampionshipSession(definition);
    }
  } else {
    championshipSession = new ChampionshipSession(definition);
  }
  syncChampionshipEventMode();
  const saveWarning = persistChampionship();
  const snapshot = championshipSession.snapshot;
  return saveWarning
    ?? `${resumed ? "Resumed" : "Started"} ${snapshot.name} · event ${snapshot.eventNumber}/${snapshot.eventCount}`;
}

function currentM1EvidenceReport(): M1EvidenceReport {
  return m1Evidence.report({
    state: state.state,
    playerCount: selectedPlayerCount(),
    loadedAssetCount: trackAssets.size + vehicleModels.size + vehicleTextures.size,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    viewportWidth: viewport.clientWidth,
    viewportHeight: viewport.clientHeight,
    devicePixelRatio: window.devicePixelRatio,
    networkRequestsAfterReset: performance
      .getEntriesByType("resource")
      .map((entry) => {
        const resource = entry as PerformanceResourceTiming;
        return {
          name: resource.name,
          initiatorType: resource.initiatorType,
          transferSize: resource.transferSize,
        };
      }),
  });
}

function resetM1Evidence(): void {
  m1Evidence.reset();
  performance.clearResourceTimings();
  m1EvidenceOutput.textContent = "Sampling reset. Keep the four-player match running for 5+ seconds.";
}

if (m1EvidenceMode) {
  window.__MASHED_M1_EVIDENCE__ = {
    version: 1,
    mode: true,
    reset: resetM1Evidence,
    report: currentM1EvidenceReport,
  };
  m1EvidenceReset.addEventListener("click", resetM1Evidence);
  m1EvidenceCapture.addEventListener("click", () => {
    const report = currentM1EvidenceReport();
    m1EvidenceOutput.textContent = JSON.stringify({
      acceptance: evaluateM1Evidence(report),
      report,
    }, null, 2);
  });
}

function activePlayerSlots(): readonly (typeof LOCAL_PLAYER_SLOTS)[number][] {
  return LOCAL_PLAYER_SLOTS.slice(0, selectedPlayerCount());
}

function createAiDrivers(): Map<string, AiRouteDriver> {
  const drivers = new Map<string, AiRouteDriver>();
  if (!trackDefinition) {
    return drivers;
  }
  const round = matchModeSession?.snapshot.round ?? 1;
  activePlayerSlots().forEach((slot, index) => {
    const difficulty = selectedAiDifficulty(index);
    if (difficulty) {
      drivers.set(slot.id, new AiRouteDriver({
        difficulty,
        seed: (0xa164_0000 ^ (round << 8) ^ index) >>> 0,
      }));
    }
  });
  return drivers;
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
  const playerOneKeyboard = vehicleKeyboardBindings(controlBindings);
  const singlePlayerKeyboard: VehicleKeyboardBindings = {
    forward: [...playerOneKeyboard.forward, ...PLAYER_TWO_KEYBOARD_BINDINGS.forward],
    reverse: [...playerOneKeyboard.reverse, ...PLAYER_TWO_KEYBOARD_BINDINGS.reverse],
    left: [...playerOneKeyboard.left, ...PLAYER_TWO_KEYBOARD_BINDINGS.left],
    right: [...playerOneKeyboard.right, ...PLAYER_TWO_KEYBOARD_BINDINGS.right],
    brake: [...playerOneKeyboard.brake, ...PLAYER_TWO_KEYBOARD_BINDINGS.brake],
    handbrake: playerOneKeyboard.handbrake,
    recover: playerOneKeyboard.recover,
    useItem: [...playerOneKeyboard.useItem, ...PLAYER_TWO_KEYBOARD_BINDINGS.useItem],
  };
  vehicleInputs = activePlayerSlots().map((slot, index) => {
    const keyboard = count === 1
      ? singlePlayerKeyboard
      : index === 0
        ? playerOneKeyboard
        : index === 1
          ? PLAYER_TWO_KEYBOARD_BINDINGS
          : GAMEPAD_ONLY_KEYBOARD_BINDINGS;
    return new BrowserVehicleInput(window, {
      gamepadIndex: slot.gamepadIndex,
      keyboard,
      deadzone: alphaSettings.gamepadDeadzone,
    });
  });
}

function applyRosterPresentation(): void {
  const count = selectedPlayerCount();
  const multiplayer = count > 1;
  const binding = (action: ControlBindingAction) => formatKeyboardCode(controlBindings.playerOne[action]);
  const driveBindings = ["forward", "reverse", "left", "right"]
    .map((action) => binding(action as ControlBindingAction))
    .join("/");
  matchModeRow.hidden = !multiplayer;
  metricSpeedLabel.textContent = multiplayer ? "P1 speed" : "Speed";
  metricWheelsLabel.textContent = multiplayer ? "P1 wheels" : "Wheels";
  metricSurfaceLabel.textContent = multiplayer ? "P1 surface" : "Surface";
  vehicleSelectRows.forEach((row, index) => {
    row.hidden = index >= count;
  });
  driverSelectRows.forEach((row, index) => {
    row.hidden = index >= count;
  });
  additionalPlayerMetrics.forEach((metric, index) => {
    metric.row.hidden = index + 1 >= count;
  });
  if (multiplayer) {
    primaryDriveGuide.innerHTML = `<b>P1 · ${driveBindings}</b> accelerate, reverse and steer`;
    primaryActionGuide.innerHTML = `<b>${binding("handbrake")}</b> handbrake · <b>${binding("brake")}</b> brake · <b>${binding("recover")}</b> recover · <b>${binding("useItem")}</b> item`;
    secondaryDriveGuide.hidden = false;
    secondaryActionGuide.hidden = false;
  } else {
    primaryDriveGuide.innerHTML = `<b>${driveBindings} / arrows</b> accelerate, reverse and steer`;
    primaryActionGuide.innerHTML = `<b>${binding("handbrake")}</b> handbrake · <b>${binding("brake")}</b> brake · <b>${binding("recover")}</b> recover · <b>${binding("useItem")} /</b> item`;
    secondaryDriveGuide.hidden = true;
    secondaryActionGuide.hidden = true;
  }
  const cpuCount = driverSelects.slice(0, count).filter((select) => select.value !== "human").length;
  gamepadGuide.innerHTML = cpuCount > 0
    ? `<b>${cpuCount} CPU driver${cpuCount === 1 ? "" : "s"}</b> use fixed-step route input · human slots keep keyboard/gamepads`
    : `<b>Gamepads 1–${count}</b> left stick · triggers · A/B/X/Y${count > 2 ? " · P3/P4 gamepad only" : ""}`;
  resetButton.textContent = multiplayer ? "Reset vehicles" : "Reset vehicle";
  runtimeShortcuts.textContent = multiplayer
    ? `P1 ${driveBindings} + ${binding("useItem")} · P2 arrows + / · ${count} gamepads · C colliders`
    : `${binding("useItem")} or / uses item · C colliders · ${binding("recover")} recovers`;
}

function configureLocalRoster(): void {
  const grid = localRosterGrid();
  physics?.setVehicleRoster(grid.map((slot) => ({ id: slot.id, spawn: slot.spawn })));
  bindVehicleModels();
}

rebuildVehicleInputs();
applyRosterPresentation();
syncAlphaSettingsControls();
syncControlBindingButtons();
settingsStatus.textContent = settingsLoad.ok
  ? settingsLoad.restored ? "Restored locally" : "Defaults active"
  : `Defaults active · restore unavailable: ${settingsLoad.error}`;
settingsBindingsStatus.textContent = controlBindingsLoad.ok
  ? controlBindingsLoad.restored ? "Bindings restored locally" : "Default bindings active · choose an action, then press a key"
  : `Default bindings active · restore unavailable: ${controlBindingsLoad.error}`;

function applyState(next: RuntimeState): void {
  const matchActive = next === "race" || next === "paused";
  if (!matchActive) {
    eliminationWarning.hidden = true;
  }
  if ((next === "loading" || matchActive) && pendingBindingAction) {
    pendingBindingAction = undefined;
    syncControlBindingButtons();
    settingsBindingsStatus.textContent = "Binding change cancelled by match transition";
  }
  stateBadge.textContent = next;
  stateBadge.dataset["state"] = next;
  startButton.disabled = next !== "menu" && next !== "results";
  importFolderButton.disabled = contentCatalogInitializing || next === "loading" || matchActive;
  importDiscButton.disabled = importFolderButton.disabled;
  const championshipPhase = championshipSession?.snapshot.phase;
  startButton.textContent = championshipPhase === "event-complete"
    ? "Next event"
    : championshipPhase === "finished"
      ? "New championship"
      : next === "results"
        ? matchModeSession?.snapshot.phase === "round-complete" ? "Next round" : "New match"
        : championshipSession
          ? `Start event ${championshipSession.snapshot.eventNumber}`
          : trackDefinition ? "Start lap" : "Start simulation";
  pauseButton.disabled = !matchActive;
  pauseButton.textContent = next === "paused" ? "Resume" : "Pause";
  pauseButton.dataset["action"] = next === "paused" ? "resume" : "pause";
  finishButton.disabled = next !== "race";
  finishButton.textContent = matchModeSession ? "Finish round" : "Finish race";
  menuButton.disabled = !matchActive && next !== "results";
  resetButton.disabled = next === "paused";
  trackSelect.disabled = localContentCatalog === undefined || next === "loading" || matchActive;
  m1EvidenceLoad.disabled = localContentCatalog === undefined || next === "loading" || matchActive;
  playerCountSelect.disabled = next === "loading" || matchActive;
  gameFlowSelect.disabled = next === "loading" || matchActive;
  matchModeSelect.disabled = next === "loading"
    || matchActive
    || selectedPlayerCount() < 2
    || selectedGameFlow() === "championship";
  vehicleSelects.forEach((select) => {
    select.disabled = next === "loading" || matchActive;
  });
  driverSelects.forEach((select) => {
    select.disabled = next === "loading" || matchActive;
  });
  settingsDifficulty.disabled = next === "loading" || matchActive;
  settingsDeadzone.disabled = next === "loading" || matchActive;
  settingsReset.disabled = next === "loading" || matchActive;
  CONTROL_BINDING_ACTIONS.forEach((action) => {
    bindingButtons[action].disabled = next === "loading" || matchActive;
  });
  pauseOverlay.hidden = next !== "paused";
  applyCombatHud();
  applyModeHud();
  applyChampionshipHud();
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

function applyModeHud(): void {
  const snapshot = matchModeSession?.snapshot;
  modeHud.hidden = !snapshot || state.state === "menu";
  if (!snapshot) {
    return;
  }
  modeHudTitle.textContent = `${MATCH_MODE_LABELS[snapshot.mode]} · round ${snapshot.round}`;
  switch (snapshot.mode) {
    case "standard":
      modeHudObjective.textContent = `Last car standing · first to ${snapshot.pointsToWin}`;
      break;
    case "team":
      modeHudObjective.textContent = `Eliminate the other team · first to ${snapshot.pointsToWin}`;
      break;
    case "hold-the-flag": {
      const holder = snapshot.players.find((player) => player.id === snapshot.flagHolderId);
      modeHudObjective.textContent = holder
        ? `${holder.displayName} holds flag · ${snapshot.flagHoldSeconds.toFixed(1)} / ${snapshot.flagHoldTargetSeconds.toFixed(0)}s`
        : "Capture the green flag";
      break;
    }
    case "fugitive": {
      const fugitive = snapshot.players.find((player) => player.id === snapshot.fugitiveId);
      modeHudObjective.textContent = `${fugitive?.displayName ?? "—"} is the fugitive · ${snapshot.roundElapsedSeconds.toFixed(1)} / ${snapshot.fugitiveSurvivalTargetSeconds.toFixed(0)}s`;
      break;
    }
  }
  const scores = snapshot.mode === "team"
    ? snapshot.teams.map((team) => ({ label: team.id, score: team.score }))
    : snapshot.players.map((player) => ({ label: player.displayName, score: player.score }));
  modeHudScores.replaceChildren(...scores.map(({ label, score }) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = label;
    const value = document.createElement("b");
    value.textContent = `${score} / ${snapshot.pointsToWin}`;
    item.append(name, value);
    return item;
  }));
}

function applyChampionshipHud(): void {
  const snapshot = championshipSession?.snapshot;
  championshipHud.hidden = !snapshot || selectedGameFlow() !== "championship";
  modeHud.classList.toggle("with-championship", !championshipHud.hidden && state.state !== "menu");
  if (!snapshot) {
    return;
  }
  const leader = snapshot.standings[0];
  championshipHudTitle.textContent = snapshot.phase === "finished"
    ? `${snapshot.name} · complete`
    : snapshot.name;
  championshipHudEvent.textContent = snapshot.phase === "finished"
    ? `${leader?.displayName ?? "—"} wins the series`
    : `Event ${snapshot.eventNumber} / ${snapshot.eventCount} · ${snapshot.currentEvent.name}`;
  championshipHudStandings.replaceChildren(...snapshot.standings.map((standing, index) => {
    const item = document.createElement("li");
    item.dataset["leader"] = String(index === 0);
    const label = document.createElement("span");
    label.textContent = `${standing.rank}. ${standing.displayName}`;
    const points = document.createElement("b");
    points.textContent = `${standing.points} PT${standing.medal === "none" ? "" : ` · ${standing.medal.toUpperCase()}`}`;
    item.append(label, points);
    return item;
  }));
}

function applyChampionshipResultBanner(): boolean {
  const snapshot = championshipSession?.snapshot;
  if (!snapshot || state.state !== "results" || matchModeSession?.snapshot.phase !== "finished") {
    return false;
  }
  const eventResult = snapshot.completedEvents.at(-1);
  const eventWinnerId = eventResult?.ranking[0];
  const eventWinner = snapshot.standings.find((standing) => standing.entrantId === eventWinnerId);
  raceBanner.hidden = false;
  raceBannerLabel.textContent = snapshot.phase === "finished" ? "Championship complete" : `Event ${snapshot.eventNumber} complete`;
  raceBannerValue.textContent = snapshot.phase === "finished"
    ? `${snapshot.standings[0]?.displayName ?? "—"} · GOLD`
    : `${eventWinner?.displayName ?? eventWinnerId ?? "—"} wins`;
  raceResults.replaceChildren(...snapshot.standings.map((standing) => {
    const item = document.createElement("li");
    const eventPoints = eventResult?.awardedPoints[standing.entrantId] ?? 0;
    item.innerHTML = `<span>${standing.rank}</span><b>${standing.displayName}</b><em>${standing.points} PT · +${eventPoints}</em>`;
    return item;
  }));
  raceResults.hidden = false;
  return true;
}

function applyModeResultBanner(): boolean {
  const snapshot = matchModeSession?.snapshot;
  if (!snapshot || snapshot.phase === "playing" || state.state !== "results") {
    return false;
  }
  const winnerNames = snapshot.roundWinnerIds.map((id) => (
    snapshot.players.find((player) => player.id === id)?.displayName ?? id
  ));
  raceBanner.hidden = false;
  raceBannerLabel.textContent = snapshot.phase === "finished" ? "Match winner" : `Round ${snapshot.round}`;
  raceBannerValue.textContent = `${winnerNames.join(" + ")} ${snapshot.phase === "finished" ? "wins" : "scores"}`;
  const results = snapshot.mode === "team"
    ? snapshot.teams.map((team) => ({ id: team.id, label: team.id, score: team.score }))
    : snapshot.players.map((player) => ({ id: player.id, label: player.displayName, score: player.score }));
  raceResults.replaceChildren(...results
    .sort((left, right) => right.score - left.score)
    .map((result, index) => {
      const item = document.createElement("li");
      item.innerHTML = `<span>${index + 1}</span><b>${result.label}</b><em>${result.score} PT</em>`;
      return item;
    }));
  raceResults.hidden = false;
  return true;
}

function applyRaceBanner(): void {
  if (applyChampionshipResultBanner()) {
    return;
  }
  if (applyModeResultBanner()) {
    return;
  }
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
        totalLaps: matchModeSession ? 999 : 1,
        countdownSeconds: 3,
        finishWhenOnePlayerRemains: false,
      })
    : undefined;
}

function combatWeaponForPowerup(type: OriginalPowerupType): CombatWeaponType | undefined {
  switch (type) {
    case "machine-gun":
      return "machine-gun";
    case "guided-missile":
      return "guided-missile";
    case "mortar":
      return "mortar";
    case "rear-flame":
      return "rear-flame";
    case "oil":
      return "oil";
    case "detonator":
    case "drum":
      return "drum-bomb";
    case "mine":
    case "proximity-mine":
      return "proximity-mine";
    case "shotgun":
      return "shotgun";
    case "flash":
      return "flash";
    default:
      return undefined;
  }
}

function combatPickupDefinitions(): readonly CombatPickupDefinition[] {
  if (trackParts.powerupPlacements) {
    return trackParts.powerupPlacements.flatMap((placement) => {
      const weapon = combatWeaponForPowerup(placement.type);
      return weapon ? [{
        id: placement.id,
        weapon,
        position: [placement.position[0], placement.position[1] + 0.8, placement.position[2]],
        respawnSeconds: placement.respawnSeconds,
      }] : [];
    });
  }

  const configuredTypes = trackParts.course && trackParts.powerupLoadouts
    ? trackParts.powerupLoadouts.find((loadout) => loadout.courseId === trackParts.course?.id)?.powerups
    : undefined;
  const configuredWeapons = configuredTypes?.flatMap((type) => {
    const weapon = combatWeaponForPowerup(type);
    return weapon ? [weapon] : [];
  });
  const weapons: readonly CombatWeaponType[] = configuredWeapons && configuredWeapons.length > 0
    ? configuredWeapons
    : ["machine-gun", "guided-missile", "proximity-mine"];
  if (trackDefinition) {
    const checkpointIndices = weapons.map((_, index) => (
      (index + 1) / (weapons.length + 1)
    )).map((ratio) => (
      Math.min(trackDefinition!.checkpoints.length - 1, Math.floor(trackDefinition!.checkpoints.length * ratio))
    ));
    return weapons.map((weapon, index) => {
      const checkpoint = trackDefinition!.checkpoints[checkpointIndices[index] ?? 0]!;
      return {
        id: `pickup-${index + 1}-${weapon}`,
        weapon,
        position: [checkpoint.center[0], checkpoint.center[1] + 0.8, checkpoint.center[2]],
      };
    });
  }
  return [
    { id: "pickup-machine-gun", weapon: "machine-gun", position: [-4, 0.7, -3] },
    { id: "pickup-guided-missile", weapon: "guided-missile", position: [-4, 0.7, 8] },
    { id: "pickup-proximity-mine", weapon: "proximity-mine", position: [-4, 0.7, 19] },
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
    const effectLabel = player.effects.map((effect) => (
      `${effect.type === "oiled" ? "OIL" : "FLASH"} ${effect.secondsRemaining.toFixed(1)}s`
    )).join(" · ");
    const health = player.destroyed
      ? "DESTROYED"
      : `${Math.ceil(player.health)} HP${effectLabel ? ` · ${effectLabel}` : ""}`;
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

function resolveMatchModeFromFinishedRace(
  event: Extract<RaceEvent, { type: "race-finished" }>,
): string | undefined {
  const snapshot = matchModeSession?.snapshot;
  const winner = event.results.find((result) => result.status !== "eliminated");
  if (!matchModeSession || snapshot?.phase !== "playing") {
    return undefined;
  }
  if (!winner) {
    fugitiveInterceptorId = undefined;
    return handleMatchModeEvents(matchModeSession.advance(STEP_SECONDS, { activePlayerIds: [] }));
  }
  const activePlayerIds = [winner.playerId];
  let modeEvents: readonly MatchModeEvent[];
  switch (snapshot.mode) {
    case "standard":
    case "team":
      modeEvents = matchModeSession.advance(STEP_SECONDS, { activePlayerIds });
      break;
    case "hold-the-flag":
      modeEvents = matchModeSession.advance(snapshot.flagHoldTargetSeconds, {
        activePlayerIds,
        flagCapturePlayerId: winner.playerId,
      });
      break;
    case "fugitive":
      modeEvents = matchModeSession.advance(STEP_SECONDS, {
        activePlayerIds,
        ...(snapshot.fugitiveId === winner.playerId
          ? { completedLapPlayerIds: [winner.playerId] }
          : { fugitiveEliminatedByPlayerId: fugitiveInterceptorId ?? winner.playerId }),
      });
      break;
  }
  fugitiveInterceptorId = undefined;
  return handleMatchModeEvents(modeEvents);
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
        if (!roundEliminationOrder.includes(event.playerId)) {
          roundEliminationOrder.push(event.playerId);
        }
        runtimeStatus.textContent = `${event.playerId} eliminated: ${event.reason}`;
        break;
      case "race-finished": {
        const winner = event.results[0];
        finishReason = winner?.status === "winner"
          ? `${winner.displayName} wins`
          : winner?.status === "finished"
            ? `${winner.displayName} finished in ${formatRaceTime(winner.timeSeconds)}`
          : "All players eliminated";
        finishReason = resolveMatchModeFromFinishedRace(event) ?? finishReason;
        break;
      }
    }
  }
  applyRaceBanner();
  return finishReason;
}

function championshipEventRanking(winnerIds: readonly string[]): readonly string[] {
  const racePlayers = new Map(raceSession?.snapshot.players.map((player) => [player.id, player]));
  return rankChampionshipEvent(activePlayerSlots().map((slot) => ({
    id: slot.id,
    completedLaps: racePlayers.get(slot.id)?.progress.completedLaps ?? 0,
    passedCheckpoints: racePlayers.get(slot.id)?.progress.passedCheckpoints ?? 0,
  })), winnerIds, roundEliminationOrder);
}

function completeChampionshipEvent(winnerIds: readonly string[]): void {
  if (!championshipSession || championshipSession.snapshot.phase !== "event-ready") {
    return;
  }
  championshipSession.completeEvent(championshipEventRanking(winnerIds));
  const warning = persistChampionship();
  if (warning) {
    runtimeStatus.textContent = warning;
  }
  applyChampionshipHud();
}

function combatSampleName(weapon: CombatWeaponType): string {
  switch (weapon) {
    case "machine-gun":
      return "machineg";
    case "guided-missile":
    case "rocket":
      return "rocket";
    case "mortar":
      return "mortarexhaust";
    case "rear-flame":
      return "flame thrower";
    case "oil":
      return "oilslick";
    case "shotgun":
      return "shotgun";
    case "flash":
      return "flash";
    case "drum-bomb":
    case "proximity-mine":
    case "mine":
      return "drop mine";
  }
}

function explosiveCombatWeapon(weapon: CombatWeaponType): boolean {
  return [
    "guided-missile",
    "mortar",
    "proximity-mine",
    "drum-bomb",
    "rocket",
    "mine",
  ].includes(weapon);
}

function handleCombatEvents(combatEvents: readonly CombatEvent[]): string | undefined {
  let finishReason: string | undefined;
  const destroyedPlayerIds = new Set<string>();
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
          sampleName: combatSampleName(event.weapon),
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
      case "weapon-boosted":
        physics?.applyVehicleImpulse(event.playerId, event.impulse);
        break;
      case "player-affected": {
        runtimeStatus.textContent = `${event.playerId} ${event.effect} for ${event.durationSeconds.toFixed(1)}s`;
        events.emit({
          type: "audio:cue",
          cue: "impact",
          gain: event.effect === "flashed" ? 0.11 : 0.07,
          sampleName: event.effect === "flashed" ? "flash" : "oilslick",
        });
        const position = physics?.getVehicleTransformHistory(event.playerId)?.current.position;
        if (position) {
          events.emit({
            type: "renderer:burst",
            position,
            color: COMBAT_EFFECT_COLORS[event.weapon],
            count: event.effect === "flashed" ? 22 : 10,
            durationSeconds: event.effect === "flashed" ? 0.55 : 0.4,
          });
        }
        if (event.effect === "flashed") {
          events.emit({ type: "renderer:flash", color: 0xffffff, durationSeconds: 0.16 });
        }
        break;
      }
      case "environment-damaged":
      case "player-damaged":
        physics?.applyVehicleImpulse(event.playerId, event.knockbackImpulse);
        runtimeStatus.textContent = `${event.playerId} ${event.healthRemaining} HP`;
        events.emit({
          type: "audio:cue",
          cue: "impact",
          gain: 0.1,
          sampleName: event.type === "player-damaged" && (event.weapon === "machine-gun" || event.weapon === "shotgun" || event.weapon === "rear-flame")
            ? "bullethitscar"
            : "explosion1",
        });
        events.emit({ type: "renderer:flash", color: 0xff493d, durationSeconds: 0.12 });
        {
          const position = physics?.getVehicleTransformHistory(event.playerId)?.current.position;
          if (position) {
            events.emit({
              type: "renderer:burst",
              position,
              color: event.type === "player-damaged" ? COMBAT_EFFECT_COLORS[event.weapon] : 0xff652f,
              count: 12,
              durationSeconds: 0.42,
            });
          }
        }
        break;
      case "environment-destroyed":
      case "player-destroyed": {
        if (event.type === "player-destroyed" && matchModeSession?.snapshot.fugitiveId === event.playerId) {
          fugitiveInterceptorId = event.sourcePlayerId;
        }
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
        destroyedPlayerIds.add(event.playerId);
        break;
      }
      case "projectile-world-impact": {
        const explosive = explosiveCombatWeapon(event.weapon);
        const impulseMagnitude = explosive ? 12_000 : 2_400;
        if (event.objectId) {
          trackHazards?.recordImpact({ id: event.objectId, position: event.position });
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
  if (destroyedPlayerIds.size > 0) {
    const playerIds = [...destroyedPlayerIds];
    const raceEvents = raceSession?.eliminatePlayers(playerIds, "destroyed") ?? [];
    if (!raceSession) {
      playerIds.forEach((playerId) => physics?.deactivateVehicle(playerId));
    }
    finishReason = handleRaceEvents(raceEvents) ?? finishReason;
  }
  applyCombatHud();
  return finishReason;
}

function handleMatchModeEvents(modeEvents: readonly MatchModeEvent[]): string | undefined {
  let resultReason: string | undefined;
  for (const event of modeEvents) {
    switch (event.type) {
      case "flag-captured":
        runtimeStatus.textContent = `${event.playerId} captured the flag`;
        events.emit({ type: "audio:cue", cue: "pickup", gain: 0.08, sampleName: "flash" });
        break;
      case "flag-dropped":
        runtimeStatus.textContent = `${event.playerId} dropped the flag`;
        break;
      case "fugitive-assigned":
        runtimeStatus.textContent = `${event.playerId} is the fugitive`;
        break;
      case "score-awarded":
        runtimeStatus.textContent = `${event.teamId ?? event.playerIds.join(" + ")} scores · ${event.score}`;
        break;
      case "round-completed":
        resultReason = event.reason === "no-survivors"
          ? `Round ${event.round} ended with no survivors`
          : `${event.winnerIds.join(" + ")} wins round ${event.round}`;
        break;
      case "match-completed":
        resultReason = `${event.winnerIds.join(" + ")} wins the match ${event.score}`;
        completeChampionshipEvent(event.winnerIds);
        break;
    }
  }
  applyModeHud();
  return resultReason;
}

function updateMatchMode(
  stepSeconds: number,
  positions: Readonly<Record<string, readonly [number, number, number]>>,
  raceEvents: readonly RaceEvent[],
): string | undefined {
  const session = matchModeSession;
  if (!session || session.snapshot.phase !== "playing") {
    return undefined;
  }
  const snapshot = session.snapshot;
  const activeIds = new Set(physics?.activeVehicleIds ?? []);
  let flagCapturePlayerId: string | undefined;
  if (snapshot.mode === "hold-the-flag") {
    const holderPosition = snapshot.flagHolderId ? positions[snapshot.flagHolderId] : undefined;
    if (holderPosition) {
      flagPosition = [holderPosition[0], holderPosition[1] + 1, holderPosition[2]];
    } else if (!snapshot.flagHolderId) {
      flagCapturePlayerId = activePlayerSlots()
        .flatMap((slot) => {
          const position = positions[slot.id];
          if (!position || !activeIds.has(slot.id)) {
            return [];
          }
          const distanceSquared = (position[0] - flagPosition[0]) ** 2
            + (position[1] - flagPosition[1]) ** 2
            + (position[2] - flagPosition[2]) ** 2;
          return distanceSquared <= 2.8 ** 2 ? [{ id: slot.id, distanceSquared }] : [];
        })
        .sort((left, right) => left.distanceSquared - right.distanceSquared)[0]?.id;
    }
  }
  const completedLapPlayerIds = raceEvents.flatMap((event) => (
    event.type === "lap-completed" ? [event.playerId] : []
  ));
  const modeEvents = session.advance(stepSeconds, {
    activePlayerIds: activePlayerSlots().map((slot) => slot.id).filter((id) => activeIds.has(id)),
    ...(flagCapturePlayerId ? { flagCapturePlayerId } : {}),
    ...(completedLapPlayerIds.length > 0 ? { completedLapPlayerIds } : {}),
    ...(fugitiveInterceptorId ? { fugitiveEliminatedByPlayerId: fugitiveInterceptorId } : {}),
  });
  fugitiveInterceptorId = undefined;
  return handleMatchModeEvents(modeEvents);
}

events.subscribe((event) => {
  if (event.type === "runtime:state-changed") {
    applyState(event.to);
    runtimeStatus.textContent = event.reason;
  } else if (event.type === "simulation:overrun") {
    totalDroppedSeconds += event.droppedSeconds;
  } else if (event.type === "physics:object-destroyed") {
    if (state.state === "race") trackHazards?.recordImpact({ id: event.id, position: event.position });
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
  state.transition("loading", "Preparing race audio…");
  try {
    await audio.unlock();
    await prepareRaceAudio();
  } catch (error) {
    assetStatus.textContent = `Audio unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
  state.transition("menu", "Race ready");
  if (selectedGameFlow() === "championship") {
    if (!championshipSession) {
      prepareChampionshipSession();
    }
    if (championshipSession?.snapshot.phase === "event-complete") {
      championshipSession.startNextEvent();
      syncChampionshipEventMode();
      const warning = persistChampionship();
      if (warning) {
        runtimeStatus.textContent = warning;
      }
    } else if (championshipSession?.snapshot.phase === "finished") {
      championshipSession = new ChampionshipSession(alphaChampionshipDefinition());
      syncChampionshipEventMode();
      const warning = persistChampionship();
      if (warning) {
        runtimeStatus.textContent = warning;
      }
    }
  } else {
    championshipSession = undefined;
  }
  const signature = currentMatchModeSignature();
  if (
    matchModeSession?.snapshot.phase === "round-complete"
    && matchModeSignature === signature
  ) {
    handleMatchModeEvents(matchModeSession.startNextRound());
  } else {
    matchModeSession = createMatchModeSession();
    matchModeSignature = matchModeSession ? signature : undefined;
  }
  flagPosition = defaultFlagPosition();
  fugitiveInterceptorId = undefined;
  roundEliminationOrder = [];
  physics.resetDemo();
  trackHazards?.reset();
  resetCameraElimination();
  raceSession = createTrackRaceSession();
  combatSession = createCombatSession();
  aiDrivers = createAiDrivers();
  latestVehicleInputs = {};
  clock.restart(performance.now() / 1000);
  totalDroppedSeconds = 0;
  state.transition("race", raceSession ? "Race countdown started" : "Fixed-step simulation running");
  viewport.focus({ preventScroll: true });
  applyRaceBanner();
  applyModeHud();
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
  viewport.focus({ preventScroll: true });
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
    const modeSnapshot = matchModeSession?.snapshot;
    if (matchModeSession && modeSnapshot?.phase === "playing") {
      const firstPlayerId = modeSnapshot.players[0]!.id;
      let modeEvents: readonly MatchModeEvent[];
      switch (modeSnapshot.mode) {
        case "standard":
          modeEvents = matchModeSession.advance(STEP_SECONDS, { activePlayerIds: [firstPlayerId] });
          break;
        case "team": {
          const teamId = modeSnapshot.players[0]!.teamId;
          modeEvents = matchModeSession.advance(STEP_SECONDS, {
            activePlayerIds: modeSnapshot.players.filter((player) => player.teamId === teamId).map((player) => player.id),
          });
          break;
        }
        case "hold-the-flag":
          modeEvents = matchModeSession.advance(modeSnapshot.flagHoldTargetSeconds, {
            activePlayerIds: modeSnapshot.players.map((player) => player.id),
            flagCapturePlayerId: firstPlayerId,
          });
          break;
        case "fugitive":
          modeEvents = matchModeSession.advance(STEP_SECONDS, {
            activePlayerIds: modeSnapshot.players.map((player) => player.id),
            completedLapPlayerIds: modeSnapshot.fugitiveId ? [modeSnapshot.fugitiveId] : [],
          });
          break;
      }
      const reason = handleMatchModeEvents(modeEvents) ?? "Round completed";
      state.transition("results", reason);
      applyRaceBanner();
      events.emit({ type: "audio:cue", cue: "race-finish", gain: 0.08 });
      return;
    }
    raceSession = undefined;
    combatSession = undefined;
    matchModeSession = undefined;
    matchModeSignature = undefined;
    aiDrivers.clear();
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
    matchModeSession = undefined;
    matchModeSignature = undefined;
    aiDrivers.clear();
    latestVehicleInputs = {};
    resetCameraElimination();
    state.transition("menu", "Runtime ready");
    applyRaceBanner();
    events.emit({ type: "audio:cue", cue: "menu", gain: 0.05 });
  }
});
resetButton.addEventListener("click", () => {
  physics?.resetDemo();
  trackHazards?.reset();
  resetCameraElimination();
  raceSession = state.state === "race" ? createTrackRaceSession() : undefined;
  combatSession = state.state === "race" ? createCombatSession() : undefined;
  aiDrivers = state.state === "race" ? createAiDrivers() : new Map();
  latestVehicleInputs = {};
  applyRaceBanner();
  applyCombatHud();
});
debugCamera.addEventListener("change", () => renderer.setDebugCamera(debugCamera.checked));
settingsDifficulty.addEventListener("change", () => {
  const difficulty = settingsDifficulty.value;
  if (difficulty !== "easy" && difficulty !== "normal" && difficulty !== "hard") {
    return;
  }
  applyAlphaSettings(
    { ...alphaSettings, difficulty },
    `CPU preset ${difficulty}`,
    { syncCpuDrivers: true },
  );
});
settingsGraphics.addEventListener("change", () => {
  const graphicsQuality = settingsGraphics.value;
  if (
    graphicsQuality !== "performance"
    && graphicsQuality !== "balanced"
    && graphicsQuality !== "quality"
  ) {
    return;
  }
  applyAlphaSettings({ ...alphaSettings, graphicsQuality }, `Graphics ${graphicsQuality}`);
});
settingsVolume.addEventListener("input", () => {
  settingsVolumeValue.value = `${settingsVolume.value}%`;
});
settingsVolume.addEventListener("change", () => {
  const masterVolume = Number(settingsVolume.value) / 100;
  applyAlphaSettings({ ...alphaSettings, masterVolume }, `Master volume ${settingsVolume.value}%`);
});
settingsDeadzone.addEventListener("input", () => {
  settingsDeadzoneValue.value = `${settingsDeadzone.value}%`;
});
settingsDeadzone.addEventListener("change", () => {
  const gamepadDeadzone = Number(settingsDeadzone.value) / 100;
  applyAlphaSettings(
    { ...alphaSettings, gamepadDeadzone },
    `Gamepad deadzone ${settingsDeadzone.value}%`,
    { rebuildInputs: true },
  );
});
settingsMuted.addEventListener("change", () => {
  applyAlphaSettings(
    { ...alphaSettings, muted: settingsMuted.checked },
    settingsMuted.checked ? "Audio muted" : "Audio enabled",
  );
});
CONTROL_BINDING_ACTIONS.forEach((action) => {
  bindingButtons[action].addEventListener("click", () => {
    if (state.state === "loading" || state.state === "race" || state.state === "paused") {
      return;
    }
    pendingBindingAction = action;
    syncControlBindingButtons();
    settingsBindingsStatus.textContent = `Press a key for ${CONTROL_BINDING_LABELS[action]} · Escape cancels`;
  });
});
window.addEventListener("keydown", (event) => {
  const action = pendingBindingAction;
  if (!action) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  if (event.code === "Escape") {
    pendingBindingAction = undefined;
    syncControlBindingButtons();
    settingsBindingsStatus.textContent = "Binding change cancelled";
    return;
  }
  if (!isRebindableKeyboardCode(event.code)) {
    settingsBindingsStatus.textContent = `${formatKeyboardCode(event.code)} is reserved or unsupported · choose a letter, number, or driving key`;
    return;
  }
  try {
    controlBindings = rebindControlAction(controlBindings, action, event.code);
    pendingBindingAction = undefined;
    syncControlBindingButtons();
    rebuildVehicleInputs();
    applyRosterPresentation();
    persistControlBindings(`${CONTROL_BINDING_LABELS[action]} uses ${formatKeyboardCode(event.code)}`);
  } catch (error) {
    settingsBindingsStatus.textContent = error instanceof Error ? error.message : String(error);
  }
}, { capture: true });
settingsReset.addEventListener("click", () => {
  controlBindings = DEFAULT_CONTROL_BINDINGS;
  pendingBindingAction = undefined;
  syncControlBindingButtons();
  persistControlBindings("Bindings reset");
  applyAlphaSettings(
    DEFAULT_ALPHA_SETTINGS,
    "Settings reset",
    { rebuildInputs: true, syncCpuDrivers: true },
  );
});
playerCountSelect.addEventListener("change", () => {
  if (selectedGameFlow() === "championship" && selectedPlayerCount() < 2) {
    playerCountSelect.value = "2";
  }
  raceSession = undefined;
  combatSession = undefined;
  matchModeSession = undefined;
  matchModeSignature = undefined;
  aiDrivers.clear();
  latestVehicleInputs = {};
  resetCameraElimination();
  rebuildVehicleInputs();
  applyRosterPresentation();
  configureLocalRoster();
  const championshipStatus = selectedGameFlow() === "championship"
    ? prepareChampionshipSession()
    : undefined;
  applyState(state.state);
  runtimeStatus.textContent = championshipStatus
    ?? `${selectedPlayerCount()} local player${selectedPlayerCount() === 1 ? "" : "s"} ready`;
});
gameFlowSelect.addEventListener("change", () => {
  if (selectedGameFlow() === "championship" && selectedPlayerCount() < 2) {
    playerCountSelect.value = "2";
  }
  raceSession = undefined;
  combatSession = undefined;
  matchModeSession = undefined;
  matchModeSignature = undefined;
  aiDrivers.clear();
  latestVehicleInputs = {};
  resetCameraElimination();
  rebuildVehicleInputs();
  applyRosterPresentation();
  configureLocalRoster();
  const flowStatus = selectedGameFlow() === "championship"
    ? prepareChampionshipSession()
    : "Single match selected";
  applyState(state.state);
  applyRaceBanner();
  runtimeStatus.textContent = flowStatus;
});
matchModeSelect.addEventListener("change", () => {
  matchModeSession = undefined;
  matchModeSignature = undefined;
  applyState(state.state);
  applyModeHud();
  runtimeStatus.textContent = `${MATCH_MODE_LABELS[selectedMatchMode()]} selected`;
});
driverSelects.forEach((select, index) => {
  select.addEventListener("change", () => {
    matchModeSession = undefined;
    matchModeSignature = undefined;
    aiDrivers.clear();
    applyRosterPresentation();
    applyState(state.state);
    const difficulty = selectedAiDifficulty(index);
    runtimeStatus.textContent = difficulty
      ? `${LOCAL_PLAYER_SLOTS[index]!.label} CPU ${difficulty} selected`
      : `${LOCAL_PLAYER_SLOTS[index]!.label} human driver selected`;
  });
});
vehicleSelects.forEach((select) => {
  select.addEventListener("click", () => {
    vehicleCatalogTarget = vehicleSelects.indexOf(select);
    openVehicleCatalog(vehicleCatalogTarget);
  });
});

function rememberBsp(fileName: string, world: BspWorld): string | undefined {
  const role = trackBspRole(fileName, trackParts.course);
  return role ? assignTrackBsp(role, world) : undefined;
}

function assignTrackBsp(role: TrackBspRole, world: BspWorld): string {
  trackParts[role] = world;
  return role === "ai" ? "AI route" : role;
}

function trackTextureDictionary(): PiTextureDictionary | undefined {
  const declaredName = trackParts.course?.textureDictionaryFileName?.toLocaleLowerCase("en-US");
  if (declaredName) {
    const asset = trackAssets.get(declaredName);
    return asset?.kind === "txd" ? asset.data : undefined;
  }
  const candidates = [...trackAssets.values()].filter((asset) => asset.kind === "txd");
  return candidates.length === 1 ? candidates[0]!.data : undefined;
}

function vehiclePairKey(pair: VehicleAssetPair): string {
  return pair.fileName.toLocaleLowerCase("en-US");
}

function vehicleDisplayName(assetName: string): string {
  const admission = admittedVehicleByAssetName(assetName);
  return admission?.displayName ?? assetName;
}

function localVehicleByAssetName(assetName: string): LocalVehicleCatalogEntry | undefined {
  const normalized = assetName.toLocaleUpperCase("en-US");
  return localContentCatalog?.vehicles.find((vehicle) => (
    vehicle.assetBaseName.toLocaleUpperCase("en-US") === normalized
  ));
}

function updateVehicleChoice(button: HTMLButtonElement, pair: VehicleAssetPair | undefined): void {
  const image = button.querySelector<HTMLImageElement>("img");
  const name = button.querySelector<HTMLElement>("span");
  const detail = button.querySelector<HTMLElement>("small");
  if (!image || !name || !detail) {
    return;
  }
  const localVehicle = pair ? localVehicleByAssetName(pair.vehicleName) : undefined;
  const preview = localVehicle ? localPreviewImages.get(localVehicle.previewTextureName) : undefined;
  image.hidden = preview === undefined;
  image.src = preview ?? "";
  image.alt = pair ? `${vehicleDisplayName(pair.vehicleName)} preview` : "";
  name.textContent = pair ? vehicleDisplayName(pair.vehicleName) : "Choose vehicle";
  detail.textContent = pair ? `Paint ${pair.variant + 1}` : "Debug proxy";
}

function refreshVehicleCatalog(): void {
  vehicleCatalog = listVehicleAssetPairs(vehicleModels.keys(), vehicleTextures.keys());
  const availableKeys = new Set(vehicleCatalog.map(vehiclePairKey));
  vehicleSelects.forEach((select, index) => {
    const previousValue = select.value;
    const defaultPair = vehicleCatalog[index % Math.max(1, vehicleCatalog.length)];
    select.value = availableKeys.has(previousValue)
      ? previousValue
      : defaultPair ? vehiclePairKey(defaultPair) : "";
    updateVehicleChoice(select, vehicleCatalog.find((pair) => vehiclePairKey(pair) === select.value));
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
    const model = vehicleModels.get(pair.fileName.toLocaleLowerCase("en-US"));
    const textures = vehicleTextures.get(pair.textureFileName.toLocaleLowerCase("en-US"));
    if (!model || !textures) {
      renderer.clearVehicleModelFor(slot.id);
      return;
    }
    const rendered = renderer.setVehicleModelFor(slot.id, model, textures);
    bound.push(
      `${slot.label} ${vehicleDisplayName(pair.vehicleName)} skin ${pair.variant} · ${rendered.atomics} atomics · ${rendered.triangles.toLocaleString()} tris${rendered.missingTextureNames.length > 0 ? ` · ${rendered.missingTextureNames.length} missing maps` : ""}`,
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
    const admittedTrack = admittedTrackByCourseId(trackParts.course.id);
    if (admittedTrack) {
      bound.push(`${admittedTrack.displayName} · admitted content batch`);
    }
    const models = [...courseModelNames(trackParts.course)].flatMap((name) => {
      const asset = trackAssets.get(name);
      return asset?.kind === "dff" ? [{ name, model: asset.data }] : [];
    });
    const rendered = renderer.setCourseModels(models);
    if (models.length > 0) {
      bound.push(
        `${rendered.models}/${models.length} world-authored DFFs · ${rendered.atomics} atomics · ${rendered.triangles.toLocaleString()} triangles${rendered.skippedLocalTemplates > 0 ? ` · ${rendered.skippedLocalTemplates} local templates skipped` : ""}${rendered.missingTextureNames.length > 0 ? ` · ${rendered.missingTextureNames.length} missing DFF maps` : ""}`,
      );
    }
  }
  refreshVehicleCatalog();
  if (trackParts.course && physics) {
    const placement = trackHazardAssets.bind(trackParts.course);
    physics.setTrackBarrels(placement.barrels);
    renderer.setTrackObjectModels(placement.models);
    trackHazards = new TrackHazardRuntime(placement.hazards, physics);
    bound.push(`${placement.barrels.length} source barrels · alpha blast rules`, ...placement.warnings);
  }
  const vehicles = bindVehicleModels();
  if (vehicles.length > 0) {
    bound.push(`vehicles ${vehicles.join(" · ")}`);
  }
  return bound;
}

function clearTrackContent(): void {
  trackAssets.clear();
  for (const key of Object.keys(trackParts) as (keyof typeof trackParts)[]) {
    delete trackParts[key];
  }
  trackDefinition = undefined;
  trackHazards = undefined;
  trackHazardAssets.clear();
  physics?.clearTrackCollision();
  physics?.setTrackBarrels([]);
  renderer.clearTrackGeometry();
  renderer.setTrackRoute([]);
  renderer.setTrackObjectModels([]);
  metricTrack.textContent = "0";
}

function resetSessionsForContentLoad(): void {
  raceSession = undefined;
  combatSession = undefined;
  championshipSession = undefined;
  matchModeSession = undefined;
  matchModeSignature = undefined;
  aiDrivers.clear();
  latestVehicleInputs = {};
  applyRaceBanner();
  applyCombatHud();
}

async function fetchLocalContentFile(source: LocalContentFile): Promise<File> {
  if (source.url.startsWith("cache:")) {
    if (!storedContent) throw new Error("Saved library is unavailable. Import your game folder again.");
    return readCachedContentFile(storedContent, source.url.slice(6), source.name);
  }
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Could not read ${source.name} (${response.status})`);
  }
  return new File([await response.blob()], source.name);
}

/** All admitted tracks share the same optional permanent bank for the lifetime of the library. */
function prepareRaceAudio(): Promise<void> | undefined {
  if (audio.masterVolume === 0) return;
  const bank = selectedTrack?.files.find((source) => source.name.toLowerCase().endsWith(".rws"));
  if (!bank) return;
  sharedBankLoad ??= fetchLocalContentFile(bank)
    .then((file) => assetLoader.load(file))
    .then(({ asset }) => {
      if (asset.kind !== "rws") throw new Error(`Invalid sound bank ${bank.name}`);
      audio.addSampleBank(asset.data.sounds);
    })
    .catch((error: unknown) => {
      sharedBankLoad = undefined;
      assetStatus.textContent = `Using synthesized audio. ${error instanceof Error ? error.message : String(error)}`;
    });
  return sharedBankLoad;
}

async function loadContentFiles(
  sources: readonly LocalContentFile[],
  label: string,
  options: { resetTrack?: boolean } = {},
): Promise<boolean> {
  if (sources.length === 0 || (state.state !== "menu" && state.state !== "results")) {
    return false;
  }
  resetSessionsForContentLoad();
  if (options.resetTrack) {
    clearTrackContent();
  }
  state.transition("loading", `Reading ${label} from your local library…`);
  assetStatus.textContent = `Reading ${label}…`;
  try {
    const summaries: string[] = [];
    let files = sources;
    if (options.resetTrack) {
      const descriptor = sources.find(({ name }) => name.toLowerCase() === "course.lua");
      if (descriptor) {
        trackParts.course = parseCourseLua(await (await fetchLocalContentFile(descriptor)).text());
        summaries.push(`${descriptor.name}: course ${trackParts.course.id}`);
      }
      files = playableTrackFiles(sources, trackParts.course);
    }
    for (const source of files) {
      const file = await fetchLocalContentFile(source);
      const normalizedName = file.name.toLocaleLowerCase("en-US");
      if (normalizedName.endsWith(".ai")) {
        const startedAt = performance.now();
        trackParts.sourceAi = parseAiData(await file.arrayBuffer());
        const occupiedCells = trackParts.sourceAi.grid.cells.reduce((sum, value) => (
          sum + Number(value !== 0xff)
        ), 0);
        summaries.push(`${file.name}: ${occupiedCells.toLocaleString()} AI cells, ${(performance.now() - startedAt).toFixed(1)} ms`);
        continue;
      }
      if (normalizedName.endsWith(".led")) {
        const startedAt = performance.now();
        trackParts.sourceLed = parseLedData(await file.arrayBuffer());
        summaries.push(`${file.name}: ${trackParts.sourceLed.entries.length} LED entries, ${(performance.now() - startedAt).toFixed(1)} ms`);
        continue;
      }
      if (normalizedName.endsWith(".lua")) {
        if (/lapdata/i.test(file.name)) {
          trackParts.lapData = parseLapDataLua(await file.text());
          summaries.push(`${file.name}: ${trackParts.lapData.line.length} route anchors`);
        } else if (/powerups?_gold/i.test(file.name)) {
          trackParts.powerupPlacements = parsePowerupPlacementsLua(await file.text());
          const playable = trackParts.powerupPlacements.filter((placement) => (
            combatWeaponForPowerup(placement.type) !== undefined
          )).length;
          summaries.push(`${file.name}: ${playable} playable pickups`);
        } else if (/powerups?_all/i.test(file.name)) {
          trackParts.powerupLoadouts = parseTrackPowerupLoadoutsLua(await file.text());
          summaries.push(`${file.name}: ${trackParts.powerupLoadouts.length} power-up loadouts`);
        }
        continue;
      }
      const result = await assetLoader.load(file);
      if (options.resetTrack) {
        trackAssets.set(normalizedName, result.asset);
        trackHazardAssets.remember(file.name, result.asset);
      }
      let role: string | undefined;
      if (result.asset.kind === "bsp") {
        role = rememberBsp(file.name, result.asset.data);
      } else if (result.asset.kind === "txd") {
        if (!options.resetTrack) vehicleTextures.set(normalizedName, result.asset.data);
        role = "textures";
      } else if (result.asset.kind === "dff") {
        if (!options.resetTrack) vehicleModels.set(normalizedName, result.asset.data);
        role = options.resetTrack ? "course model" : "vehicle";
      }
      summaries.push(
        `${file.name}: ${assetSummary(result.asset)}, ${result.parseMilliseconds.toFixed(1)} ms${role ? ` · ${role}` : ""}`,
      );
    }
    const bound = options.resetTrack ? bindTrackParts() : [];
    if (!options.resetTrack) refreshVehicleCatalog();
    assetStatus.textContent = [
      `${label}: ${summaries.length} local files loaded`,
      ...summaries.slice(0, 6),
      ...(summaries.length > 6 ? [`+ ${summaries.length - 6} more parsed files`] : []),
      ...(bound.length > 0 ? [`Bound: ${bound.join(" · ")}`] : []),
    ].join(" · ");
    const championshipStatus = selectedGameFlow() === "championship"
      ? prepareChampionshipSession()
      : undefined;
    state.transition(
      "menu",
      `${trackDefinition
        ? `Playable track ready · ${trackDefinition.checkpoints.length} checkpoints`
        : `${label} ready`}${championshipStatus ? ` · ${championshipStatus}` : ""}`,
    );
    return true;
  } catch (error) {
    if (options.resetTrack) {
      clearTrackContent();
      selectedTrack = undefined;
      trackSelectName.textContent = "Choose a track";
      trackSelectDetail.textContent = "Your local game library";
      trackSelectImage.hidden = true;
      localContentStatus.textContent = `Could not load ${label}. Choose a track to retry.`;
    }
    assetStatus.textContent = error instanceof Error ? error.message : String(error);
    if (selectedGameFlow() === "championship") {
      prepareChampionshipSession();
    }
    state.transition("menu", "Local content loading failed; runtime remains available");
    return false;
  }
}

function texturePreviewUrl(dictionary: PiTextureDictionary, textureName: string): string | undefined {
  const image = dictionary.textures.find((texture) => texture.name === textureName)?.mipmaps[0];
  if (!image) {
    return undefined;
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return undefined;
  }
  context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0);
  return canvas.toDataURL("image/jpeg", 0.88);
}

function catalogCard(
  title: string,
  detail: string,
  previewTextureName: string,
  available: boolean,
  selected: boolean,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "catalog-card";
  button.disabled = !available;
  button.dataset["selected"] = String(selected);
  const image = document.createElement("img");
  image.alt = `${title} preview`;
  image.src = localPreviewImages.get(previewTextureName) ?? "";
  const copy = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = title;
  const small = document.createElement("small");
  small.textContent = available ? detail : "Files missing";
  copy.append(strong, small);
  button.append(image, copy);
  return button;
}

function showCatalogDialog(): void {
  if (!contentCatalogDialog.open) {
    contentCatalogDialog.showModal();
  }
}

function openTrackCatalog(): void {
  if (!localContentCatalog) {
    return;
  }
  contentCatalogKicker.textContent = "Stage 6 tracks";
  contentCatalogTitle.textContent = "Choose a track";
  contentCatalogDescription.textContent = "Choose a course to load its route, scenery and hazards.";
  contentCatalogFooter.hidden = true;
  contentCatalogGrid.dataset["kind"] = "track";
  const cards = localContentCatalog.tracks.map((track) => {
    const card = catalogCard(
      track.displayName,
      `Course ${track.courseId} · ${track.files.length} files`,
      track.previewTextureName,
      track.available,
      track.id === selectedTrack?.id,
    );
    card.addEventListener("click", () => {
      contentCatalogDialog.close();
      void selectCatalogTrack(track);
    });
    return card;
  });
  contentCatalogGrid.replaceChildren(...cards);
  showCatalogDialog();
}

function renderVehicleVariants(vehicle: LocalVehicleCatalogEntry): void {
  const variants = vehicle.variants.map(({ variant }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(variant + 1);
    button.dataset["selected"] = String(variant === pendingVehicleVariant);
    button.setAttribute("aria-label", `Choose paint ${variant + 1}`);
    button.addEventListener("click", () => {
      pendingVehicleVariant = variant;
      renderVehicleVariants(vehicle);
    });
    return button;
  });
  vehicleVariantList.replaceChildren(...variants);
}

function renderVehicleCatalog(): void {
  if (!localContentCatalog) {
    return;
  }
  const cards = localContentCatalog.vehicles.map((vehicle) => {
    const card = catalogCard(
      vehicle.displayName,
      `${vehicle.variants.length} paints`,
      vehicle.previewTextureName,
      vehicle.available,
      vehicle.id === pendingVehicleCatalogId,
    );
    card.addEventListener("click", () => {
      pendingVehicleCatalogId = vehicle.id;
      if (!vehicle.variants.some(({ variant }) => variant === pendingVehicleVariant)) {
        pendingVehicleVariant = vehicle.variants[0]?.variant ?? 0;
      }
      renderVehicleCatalog();
    });
    return card;
  });
  contentCatalogGrid.replaceChildren(...cards);
  const selected = localContentCatalog.vehicles.find((vehicle) => vehicle.id === pendingVehicleCatalogId);
  if (selected) {
    renderVehicleVariants(selected);
  } else {
    vehicleVariantList.replaceChildren();
  }
  vehicleCatalogConfirm.disabled = selected === undefined || !selected.available;
}

function openVehicleCatalog(target: number): void {
  if (!localContentCatalog || target < 0 || target >= selectedPlayerCount()) {
    return;
  }
  vehicleCatalogTarget = target;
  const currentPair = vehicleCatalog.find((pair) => vehiclePairKey(pair) === vehicleSelects[target]?.value);
  const currentLocalVehicle = currentPair ? localVehicleByAssetName(currentPair.vehicleName) : undefined;
  const firstAvailable = localContentCatalog.vehicles.find((vehicle) => vehicle.available);
  pendingVehicleCatalogId = currentLocalVehicle?.id ?? firstAvailable?.id;
  pendingVehicleVariant = currentPair?.variant ?? firstAvailable?.variants[0]?.variant ?? 0;
  contentCatalogKicker.textContent = `Garage · ${LOCAL_PLAYER_SLOTS[target]!.label}`;
  contentCatalogTitle.textContent = "Choose a vehicle";
  contentCatalogDescription.textContent = "Pick a car from the extracted roster, then choose one of its six original paint variants.";
  contentCatalogFooter.hidden = false;
  contentCatalogGrid.dataset["kind"] = "vehicle";
  renderVehicleCatalog();
  showCatalogDialog();
}

async function selectCatalogTrack(track: LocalTrackCatalogEntry): Promise<void> {
  if (track.id === selectedTrack?.id) return;
  const loaded = await loadContentFiles(track.files, track.displayName, { resetTrack: true });
  if (!loaded) {
    return;
  }
  selectedTrack = track;
  const preview = localPreviewImages.get(track.previewTextureName);
  trackSelectImage.hidden = preview === undefined;
  trackSelectImage.src = preview ?? "";
  trackSelectImage.alt = `${track.displayName} preview`;
  trackSelectName.textContent = track.displayName;
  trackSelectDetail.textContent = `Course ${track.courseId} · ${trackDefinition?.checkpoints.length ?? 0} checkpoints`;
  localContentStatus.textContent = `${track.displayName} is loaded from ${storedContent ? "browser storage" : "local game-data"}.`;
}

async function selectCatalogVehicle(): Promise<void> {
  const vehicle = localContentCatalog?.vehicles.find((entry) => entry.id === pendingVehicleCatalogId);
  const variant = vehicle?.variants.find((entry) => entry.variant === pendingVehicleVariant);
  if (!vehicle?.texture || !variant) {
    return;
  }
  contentCatalogDialog.close();
  const modelKey = variant.model.name.toLocaleLowerCase("en-US");
  const textureKey = vehicle.texture.name.toLocaleLowerCase("en-US");
  const missingFiles = [
    ...(vehicleTextures.has(textureKey) ? [] : [vehicle.texture]),
    ...(vehicleModels.has(modelKey) ? [] : [variant.model]),
  ];
  if (missingFiles.length > 0) {
    const loaded = await loadContentFiles(missingFiles, `${vehicle.displayName} paint ${variant.variant + 1}`);
    if (!loaded) {
      return;
    }
  }
  const target = vehicleSelects[vehicleCatalogTarget];
  if (!target) {
    return;
  }
  target.value = modelKey;
  refreshVehicleCatalog();
  const bound = bindVehicleModels();
  runtimeStatus.textContent = bound.length > 0
    ? `${LOCAL_PLAYER_SLOTS[vehicleCatalogTarget]!.label} uses ${vehicle.displayName} · paint ${variant.variant + 1}`
    : "Vehicle model could not be bound";
}

async function initializeLocalContentCatalog(): Promise<void> {
  let storageWarning = "";
  try {
    const store = await ContentStore.open();
    try {
      storedContent = await store.manifest("active");
      const pending = await store.manifest("pending");
      if (pending) importStatus.textContent = `Unfinished import: ${Object.keys(pending.hashes).length}/${pending.total} files saved. Select the same folder or CUE/BIN pair to resume.`;
    } finally { store.close(); }
  } catch (error) {
    storageWarning = error instanceof Error ? error.message : String(error);
    importStatus.textContent = `Storage unavailable: ${storageWarning}. You can retry the import.`;
  }
  try {
    let catalog: LocalContentCatalog;
    if (storedContent) catalog = storedContent.catalog;
    else if (import.meta.env.DEV) {
      const response = await fetch("/__mashed/catalog.json");
      if (!response.ok) throw new Error(`catalog returned ${response.status}`);
      catalog = await response.json() as LocalContentCatalog;
    } else {
      localContentCount.textContent = "No library yet";
      localContentStatus.textContent = "Import a game folder or CUE/BIN image to choose tracks and vehicles.";
      return;
    }
    if (catalog.version !== 1) throw new Error("unsupported catalog version");
    if (catalog.previewDictionary) {
      // Thumbnails are optional: a missing cache entry must not lock the import UI.
      try {
        const previewFile = await fetchLocalContentFile(catalog.previewDictionary);
        const result = await assetLoader.load(previewFile);
        if (result.asset.kind !== "txd") throw new Error("preview dictionary is not a TXD");
        const dictionary = result.asset.data;
        const names = new Set([
          ...catalog.tracks.map((track) => track.previewTextureName),
          ...catalog.vehicles.map((vehicle) => vehicle.previewTextureName),
        ]);
        localPreviewImages = new Map([...names].flatMap((name) => {
          const preview = texturePreviewUrl(dictionary, name);
          return preview ? [[name, preview] as const] : [];
        }));
      } catch (error) {
        importStatus.textContent = `Previews unavailable: ${error instanceof Error ? error.message : String(error)}. Import the folder again to repair saved data.`;
      }
    }
    localContentCatalog = catalog;
    const trackCount = catalog.tracks.filter((track) => track.available).length;
    const vehicleCount = catalog.vehicles.filter((vehicle) => vehicle.available).length;
    localContentCount.textContent = `${trackCount} tracks · ${vehicleCount} vehicles`;
    localContentStatus.textContent = storedContent
      ? `Saved library ready · ${(storedContent.bytes / 1024 / 1024).toFixed(1)} MB. No folder selection needed on restart.`
      : trackCount > 0 ? "Development library ready. Import a folder to keep a copy in this browser."
        : "No local library found. Import your installed game folder.";
    refreshVehicleCatalog();
  } catch (error) {
    localContentCount.textContent = "Import needed";
    localContentStatus.textContent = `Library unavailable: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    contentCatalogInitializing = false;
    showOfflineReadiness();
    applyState(state.state);
  }
}

importFolderButton.addEventListener("click", () => {
  if (state.state !== "menu" && state.state !== "results") return;
  importFolderInput.value = "";
  importFolderInput.click();
});
importDiscButton.addEventListener("click", () => {
  if (state.state !== "menu" && state.state !== "results") return;
  importDiscInput.value = "";
  importDiscInput.click();
});
importCancelButton.addEventListener("click", () => {
  cancelContentImport?.();
  importCancelButton.disabled = true;
  importStatus.textContent = "Cancelling… Saved progress will be kept.";
});
function startContentImport(input: HTMLInputElement, sourceKind: "folder" | "disc"): void {
  const files = [...(input.files ?? [])];
  if (!files.length || (state.state !== "menu" && state.state !== "results")) return;
  void (async () => {
    state.transition("loading", sourceKind === "disc" ? "Importing your disc image…" : "Importing your game folder…");
    importProgress.hidden = false;
    importProgress.removeAttribute("value");
    importCancelButton.hidden = false;
    importCancelButton.disabled = false;
    importStatus.textContent = "Reading selected source. Keep this tab open; you can cancel and retry later.";
    try {
      const job = importGameSource(files, sourceKind, (progress) => {
        if (importCancelButton.disabled) return;
        importProgress.max = Math.max(1, progress.total);
        importProgress.value = progress.completed;
        importStatus.textContent = progress.unit === "bytes" ? progress.label
          : `${progress.label} · ${progress.completed}/${progress.total}`;
      }, () => {
        importCancelButton.disabled = true;
        importStatus.textContent = "Finishing import…";
      });
      cancelContentImport = job.cancel;
      await job.result;
      importProgress.value = importProgress.max;
      importStatus.textContent = "Library saved. Reloading the game…";
      // Start cleanly: no in-memory track, car or sound from the previous library may leak in.
      window.location.reload();
    } catch (error) {
      importStatus.textContent = error instanceof Error ? error.message : String(error);
      state.transition("menu", "Import stopped; your previous library is still available");
    } finally {
      cancelContentImport = undefined;
      input.value = "";
      importCancelButton.hidden = true;
      importProgress.hidden = true;
    }
  })();
}
importFolderInput.addEventListener("change", () => startContentImport(importFolderInput, "folder"));
importDiscInput.addEventListener("change", () => startContentImport(importDiscInput, "disc"));

trackSelect.addEventListener("click", openTrackCatalog);
m1EvidenceLoad.addEventListener("click", openTrackCatalog);
vehicleCatalogConfirm.addEventListener("click", () => {
  void selectCatalogVehicle();
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
viewport.addEventListener("pointerdown", (event) => {
  if (!isInteractiveKeyboardTarget(event.target)) {
    viewport.focus({ preventScroll: true });
  }
});
window.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && (state.state === "race" || state.state === "paused")) {
    event.preventDefault();
    if (state.state === "paused") {
      resumeRace();
    } else {
      pauseRace();
    }
  } else if (event.code === "KeyC" && !isInteractiveKeyboardTarget(event.target)) {
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

function currentModeObjective(): { kind: "flag" | "fugitive"; position: readonly [number, number, number] } | undefined {
  const snapshot = matchModeSession?.snapshot;
  if (!snapshot || snapshot.phase !== "playing") {
    return undefined;
  }
  if (snapshot.mode === "hold-the-flag") {
    return { kind: "flag", position: flagPosition };
  }
  if (snapshot.mode === "fugitive" && snapshot.fugitiveId) {
    const position = physics?.getVehicleTransformHistory(snapshot.fugitiveId)?.current.position;
    return position
      ? { kind: "fugitive", position: [position[0], position[1] + 1.5, position[2]] }
      : undefined;
  }
  return undefined;
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
  return handleRaceEvents(raceSession.eliminatePlayers(
    update.eliminatedPlayerIds,
    "camera-distance",
  ));
}

function sampleVehicleInputs(
  gamepads: readonly (Gamepad | null)[],
  stepSeconds: number,
): VehicleInputById {
  const sampled: Record<string, VehicleInputFrame> = {};
  const racePlayers = new Map(raceSession?.snapshot.players.map((player) => [player.id, player]));
  const combatPlayers = new Map(combatSession?.snapshot.players.map((player) => [player.id, player]));
  activePlayerSlots().forEach((slot, index) => {
    const canDrive = !raceSession || (
      raceSession.phase === "racing" && racePlayers.get(slot.id)?.status === "racing"
    );
    let input: VehicleInputFrame = NEUTRAL_VEHICLE_INPUT;
    const aiDriver = aiDrivers.get(slot.id);
    const aiDifficulty = selectedAiDifficulty(index);
    const player = racePlayers.get(slot.id);
    if (canDrive && aiDriver && player && trackDefinition && physics) {
      const checkpointIndex = trackDefinition.checkpoints.findIndex((checkpoint) => (
        checkpoint.id === player.progress.nextCheckpointId
      ));
      const history = physics.getVehicleTransformHistory(slot.id);
      const telemetry = physics.getVehicleTelemetry(slot.id);
      if (checkpointIndex >= 0 && history && telemetry) {
        const checkpoint = trackDefinition.checkpoints[checkpointIndex]!;
        const heldWeapon = combatPlayers.get(slot.id)?.inventory?.weapon;
        const opponents = activePlayerSlots().flatMap((opponentSlot) => {
          if (opponentSlot.id === slot.id || !physics?.activeVehicleIds.includes(opponentSlot.id)) {
            return [];
          }
          const opponentPosition = physics.getVehicleTransformHistory(opponentSlot.id)?.current.position;
          return opponentPosition ? [{ id: opponentSlot.id, position: opponentPosition }] : [];
        });
        const driverState = {
          position: history.current.position,
          headingRadians: telemetry.headingRadians,
          speedMetersPerSecond: telemetry.speedMetersPerSecond,
          precedingCheckpoint: trackDefinition.checkpoints[
            (checkpointIndex - 1 + trackDefinition.checkpoints.length) % trackDefinition.checkpoints.length
          ]!,
          checkpoint,
          followingCheckpoint: trackDefinition.checkpoints[
            (checkpointIndex + 1) % trackDefinition.checkpoints.length
          ]!,
          ...(heldWeapon ? { heldWeapon, opponents } : {}),
        };
        input = aiDriver.advance(stepSeconds, {
          ...driverState,
          navigationTargets: probeAiNavigation(physics, driverState),
        });
      }
    } else if (canDrive && !aiDifficulty) {
      input = vehicleInputs[index]?.sample(gamepads) ?? NEUTRAL_VEHICLE_INPUT;
    }
    const effects = combatPlayers.get(slot.id)?.effects ?? [];
    const oiled = effects.some((effect) => effect.type === "oiled");
    const flashed = effects.some((effect) => effect.type === "flashed");
    sampled[slot.id] = effects.length === 0 ? input : {
      ...input,
      drive: flashed ? input.drive * 0.7 : input.drive,
      steer: input.steer * (oiled ? 0.28 : 1) * (flashed ? -1 : 1),
    };
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
      if (raceFinishReason || raceSession?.phase === "finished") {
        return;
      }
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
      const sampledInputs = sampleVehicleInputs(gamepads, stepSeconds);
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
      if (!raceFinishReason && (!raceSession || raceSession.phase === "racing")) {
        if (trackHazards && combatSession) {
          const update = trackHazards.advance(stepSeconds, combatSession, currentCombatPlayerFrames());
          for (const event of update.hazardEvents) {
            const exploding = event.type === "hazard-exploded";
            events.emit({ type: "renderer:burst", position: event.position, color: exploding ? 0xff652f : 0xffdc59,
              count: exploding ? 36 : 12, durationSeconds: exploding ? 0.8 : 0.35 });
            events.emit({ type: "audio:cue", cue: exploding ? "impact" : "pickup", gain: exploding ? 0.15 : 0.06,
              ...(exploding ? { sampleName: "explosion1" } : {}) });
            runtimeStatus.textContent = exploding ? `${event.id} exploded` : `${event.id} armed`;
          }
          raceFinishReason = handleCombatEvents(update.combatEvents) ?? raceFinishReason;
        }
      }
      if (!raceFinishReason && (!raceSession || raceSession.phase === "racing")) {
        const modeFinishReason = updateMatchMode(stepSeconds, positions, raceEvents);
        if (modeFinishReason) {
          raceFinishReason = modeFinishReason;
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
  const modeObjective = currentModeObjective();
  renderer.render({
    history: physics.transformHistory,
    objects: physics.sceneObjects,
    primaryVehicleActive: physics.activeVehicleIds.includes(PRIMARY_VEHICLE_ID),
    ...(combatSession ? { combat: combatSession.snapshot } : {}),
    ...(modeObjective ? { modeObjective } : {}),
    interpolationAlpha: frame.interpolationAlpha,
    frameDeltaSeconds: renderDeltaSeconds,
    ...(debugColliders.checked ? { debugLines: physics.debugLines() } : {}),
  });
  updateEngineAudio();

  if (m1EvidenceMode && state.state === "race") {
    const physicsMetrics = physics.metrics;
    const renderMetrics = renderer.metrics;
    m1Evidence.record({
      timestampMilliseconds,
      frameMilliseconds: renderDeltaSeconds * 1000,
      physicsMilliseconds,
      fps: smoothedFps,
      simulationStep: frame.simulationStep,
      droppedSeconds: totalDroppedSeconds,
      activeVehicles: physics.activeVehicleIds.length,
      bodies: physicsMetrics.bodies,
      colliders: physicsMetrics.colliders,
      contacts: physicsMetrics.contacts,
      drawCalls: renderMetrics.drawCalls,
      triangles: renderMetrics.triangles,
      geometries: renderMetrics.geometries,
      textures: renderMetrics.textures,
      sceneObjects: renderMetrics.sceneObjects,
      combatPickups: renderMetrics.combatPickups,
      combatProjectiles: renderMetrics.combatProjectiles,
      burstEffects: renderMetrics.burstEffects,
      particles: renderMetrics.particles,
      drawingBufferWidth: renderMetrics.drawingBufferWidth,
      drawingBufferHeight: renderMetrics.drawingBufferHeight,
    });
  }

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
    const hazards = trackHazards?.snapshot.hazards ?? [];
    metricHazards.textContent = ["armed", "fusing", "spent"].map((phase) => hazards.filter((hazard) => hazard.phase === phase).length).join(" / ");
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
    applyModeHud();
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

void initializeLocalContentCatalog();
if (import.meta.env.PROD) {
  const offlineStatus = element<HTMLElement>("offline-status");
  offlineStatus.hidden = false;
  offlineStatus.textContent = "Preparing offline launch…";
  void prepareOfflineLaunch().then(() => {
    offlineShellReady = true;
    showOfflineReadiness();
  }).catch((error: unknown) => {
    offlineStatus.textContent = `Offline launch unavailable. ${error instanceof Error ? error.message : String(error)}`;
  });
}
void boot();
