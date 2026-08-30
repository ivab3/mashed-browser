import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { FixedStepClock, LapSession, type LapProgress } from "@mashed/core";

import {
  alphaContentBatch,
  deriveTrackDefinition,
  parseBspWorld,
  parseCourseLua,
  parseDff,
  parseLapDataLua,
  parsePiTextureDictionary,
  parsePowerupPlacementsLua,
  type AlphaTrackAdmission,
  type AlphaVehicleAdmission,
  type DerivedTrackDefinition,
} from "@mashed/assets";

const workspaceDirectory = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_CONTENT_ROOT = resolve(workspaceDirectory, "game-data/expanded/piz/TOASTART");

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function actualFileName(directory: string, requestedName: string): Promise<string> {
  const names = await readdir(directory);
  const match = names.find((name) => (
    name.toLocaleLowerCase("en-US") === requestedName.toLocaleLowerCase("en-US")
  ));
  if (!match) {
    throw new Error(`${directory} is missing ${requestedName}`);
  }
  return match;
}

async function loadFile(
  directory: string,
  requestedName: string,
  acceptedNames?: Set<string>,
): Promise<Buffer> {
  const name = await actualFileName(directory, requestedName);
  acceptedNames?.add(name.toLocaleLowerCase("en-US"));
  return readFile(resolve(directory, name));
}

interface RouteReplayOutcome {
  processedFrames: number;
  checkpointSequence: readonly number[];
  progress: LapProgress;
}

function runRouteRulesReplay(
  track: DerivedTrackDefinition,
  refreshRate: number,
): RouteReplayOutcome {
  const session = new LapSession(track);
  const positions = [...track.checkpoints.slice(1), track.checkpoints[0]!]
    .map((checkpoint) => checkpoint.center);
  const clock = new FixedStepClock({ stepSeconds: 1 / 60 });
  const checkpointSequence: number[] = [];
  let processedFrames = 0;
  let previousPosition = track.checkpoints[0]!.center;
  const simulate = (): void => {
    const position = positions[processedFrames];
    if (!position) {
      return;
    }
    processedFrames += 1;
    const update = session.update(position, previousPosition);
    previousPosition = position;
    if (update.checkpointPassed !== null) {
      checkpointSequence.push(update.checkpointPassed);
    }
  };
  clock.advance(0, simulate);
  const presentationFrames = Math.ceil((positions.length / 60) * refreshRate);
  for (let frame = 1; frame <= presentationFrames; frame += 1) {
    clock.advance(frame / refreshRate, simulate);
  }
  return {
    processedFrames,
    checkpointSequence,
    progress: session.progress,
  };
}

function dffMetrics(models: readonly ReturnType<typeof parseDff>[]): {
  models: number;
  atomics: number;
  triangles: number;
} {
  return {
    models: models.length,
    atomics: models.reduce((sum, model) => sum + model.atomics.length, 0),
    triangles: models.reduce((sum, model) => sum + model.geometries.reduce((geometrySum, geometry) => (
      geometrySum + geometry.triangleCount
    ), 0), 0),
  };
}

async function validateTrack(contentRoot: string, admission: AlphaTrackAdmission): Promise<object> {
  const directory = resolve(contentRoot, "TRACKS", admission.directoryName);
  const acceptedNames = new Set<string>();
  const course = parseCourseLua((await loadFile(directory, "COURSE.LUA", acceptedNames)).toString("utf8"));
  if (course.id !== admission.courseId) {
    throw new Error(`${admission.id} expected course ${admission.courseId}, received ${course.id}`);
  }
  if (
    !course.aiBspFileName
    || !course.collisionBspFileName
    || !course.worldBspFileName
    || !course.textureDictionaryFileName
  ) {
    throw new Error(`${admission.id} does not declare the complete browser track bundle`);
  }
  const [ai, collision, graphics, textureDictionary, lapData] = await Promise.all([
    loadFile(directory, course.aiBspFileName, acceptedNames).then(parseBspWorld),
    loadFile(directory, course.collisionBspFileName, acceptedNames).then(parseBspWorld),
    loadFile(directory, course.worldBspFileName, acceptedNames).then(parseBspWorld),
    loadFile(directory, course.textureDictionaryFileName, acceptedNames).then(parsePiTextureDictionary),
    loadFile(directory, "LAPDATA.LUA", acceptedNames).then((source) => (
      parseLapDataLua(source.toString("utf8"))
    )),
  ]);
  const track = deriveTrackDefinition(ai, lapData);
  const declaredDffNames = [...new Set([
    ...course.skies.map((sky) => sky.fileName),
    ...course.clumps.map((clump) => clump.fileName),
    ...course.objectTemplates.map((template) => template.dffFileName),
    ...(course.lightsFileName ? [course.lightsFileName] : []),
  ])];
  const declaredModels = await Promise.all(declaredDffNames.map((name) => (
    loadFile(directory, name, acceptedNames).then(parseDff)
  )));
  const powerups = admission.powerupFileName
    ? parsePowerupPlacementsLua(
      (await loadFile(directory, admission.powerupFileName, acceptedNames)).toString("utf8"),
    )
    : [];
  const replayMatrix = [30, 60, 120].map((refreshRate) => ({
    refreshRate,
    outcome: runRouteRulesReplay(track, refreshRate),
  }));
  const baseline = JSON.stringify(replayMatrix[0]!.outcome);
  const deterministic = replayMatrix.every(({ outcome }) => JSON.stringify(outcome) === baseline);
  if (
    !deterministic
    || replayMatrix.some(({ outcome }) => (
      outcome.processedFrames !== track.checkpoints.length
      || outcome.progress.completedLaps !== 1
      || outcome.checkpointSequence.length !== track.checkpoints.length
    ))
  ) {
    throw new Error(`${admission.id} route replay did not complete deterministically`);
  }

  const sourceNames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const boundaryReport = admission.resourceBoundaries.map((boundary) => ({
    ...boundary,
    files: sourceNames.filter((name) => (
      name.toLocaleLowerCase("en-US").endsWith(boundary.suffix.toLocaleLowerCase("en-US"))
    )).sort((left, right) => left.localeCompare(right, "en-US")),
  }));
  const boundaryNames = new Set(boundaryReport.flatMap((boundary) => boundary.files)
    .map((name) => name.toLocaleLowerCase("en-US")));
  const unmatchedBoundaries = boundaryReport.filter((boundary) => boundary.files.length === 0);
  const unclassifiedFiles = sourceNames.filter((name) => (
    !acceptedNames.has(name.toLocaleLowerCase("en-US"))
    && !boundaryNames.has(name.toLocaleLowerCase("en-US"))
  ));
  if (unmatchedBoundaries.length > 0 || unclassifiedFiles.length > 0) {
    throw new Error(
      `${admission.id} track boundary mismatch; unmatched: ${unmatchedBoundaries.map((boundary) => boundary.suffix).join(", ") || "none"}; unclassified: ${unclassifiedFiles.join(", ") || "none"}`,
    );
  }

  return {
    id: admission.id,
    courseId: course.id,
    checkpoints: track.checkpoints.length,
    splitCheckpoints: track.splitCheckpointIds.length,
    graphicsTriangles: graphics.header.triangleCount,
    collisionTriangles: collision.header.triangleCount,
    textures: textureDictionary.textures.length,
    courseModels: dffMetrics(declaredModels),
    powerups: powerups.length,
    routeReplay: {
      deterministic,
      matrix: replayMatrix.map(({ refreshRate, outcome }) => ({
        refreshRate,
        processedFrames: outcome.processedFrames,
        completedLaps: outcome.progress.completedLaps,
      })),
    },
    resourceBoundaries: boundaryReport,
  };
}

async function validateVehicle(
  contentRoot: string,
  admission: AlphaVehicleAdmission,
): Promise<object> {
  const directory = resolve(contentRoot, "VEHICLES", admission.directoryName);
  const acceptedNames = new Set<string>();
  const textureDictionary = parsePiTextureDictionary(
    await loadFile(directory, `${admission.assetBaseName}.TXD`, acceptedNames),
  );
  const models = await Promise.all(admission.variants.map((variant) => (
    loadFile(directory, `${admission.assetBaseName}${variant}.DFF`, acceptedNames).then(parseDff)
  )));
  const sourceNames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const boundaryReport = admission.resourceBoundaries.map((boundary) => ({
    ...boundary,
    files: boundary.fileNames.map((requestedName) => (
      sourceNames.find((name) => (
        name.toLocaleLowerCase("en-US") === requestedName.toLocaleLowerCase("en-US")
      )) ?? requestedName
    )),
  }));
  const boundaryNames = new Set(boundaryReport.flatMap((boundary) => boundary.files)
    .map((name) => name.toLocaleLowerCase("en-US")));
  const missingBoundaryFiles = boundaryReport.flatMap((boundary) => boundary.files)
    .filter((name) => !sourceNames.some((sourceName) => (
      sourceName.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US")
    )));
  const unclassifiedFiles = sourceNames.filter((name) => (
    !acceptedNames.has(name.toLocaleLowerCase("en-US"))
    && !boundaryNames.has(name.toLocaleLowerCase("en-US"))
  ));
  if (missingBoundaryFiles.length > 0 || unclassifiedFiles.length > 0) {
    throw new Error(
      `${admission.id} vehicle boundary mismatch; missing: ${missingBoundaryFiles.join(", ") || "none"}; unclassified: ${unclassifiedFiles.join(", ") || "none"}`,
    );
  }
  return {
    id: admission.id,
    nameMapping: admission.nameMapping,
    variants: [...admission.variants],
    textures: textureDictionary.textures.length,
    models: dffMetrics(models),
    resourceBoundaries: boundaryReport,
  };
}

const batchId = argumentValue("--batch") ?? "6.6a-city-wildfire";
const contentRoot = resolve(argumentValue("--root") ?? DEFAULT_CONTENT_ROOT);
const batch = alphaContentBatch(batchId);
if (!batch) {
  throw new Error(`Unknown alpha content batch ${batchId}`);
}

const [tracks, vehicles] = await Promise.all([
  Promise.all(batch.tracks.map((track) => validateTrack(contentRoot, track))),
  Promise.all(batch.vehicles.map((vehicle) => validateVehicle(contentRoot, vehicle))),
]);

console.log(JSON.stringify({
  version: 1,
  accepted: true,
  batchId: batch.id,
  contentRoot,
  tracks,
  vehicles,
}, null, 2));
