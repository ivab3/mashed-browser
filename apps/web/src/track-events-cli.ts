import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALPHA_CONTENT_BATCHES, parseCourseLua, parseDff, parseMts } from "@mashed/assets";
import { RuntimeEventBus } from "@mashed/core";
import { createPhysicsRuntime } from "@mashed/physics";
import { TrackHazardAssets } from "./track-hazard-assets.js";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../../../game-data/expanded/piz/TOASTART", import.meta.url)));
const reports = [];
for (const track of ALPHA_CONTENT_BATCHES.flatMap((batch) => batch.tracks)) {
  const directory = resolve(root, "TRACKS", track.directoryName);
  const names = await readdir(directory);
  const file = async (requested: string) => {
    const name = names.find((candidate) => candidate.toLowerCase() === requested.toLowerCase());
    if (!name) throw new Error(`${track.id}: missing ${requested}`);
    return readFile(resolve(directory, name));
  };
  const course = parseCourseLua((await file("COURSE.LUA")).toString("utf8"));
  const assets = new TrackHazardAssets();
  let expectedBarrels = 0;
  for (const pair of course.explosiveObjects) {
    const dff = course.clumps.find((clump) => clump.index === pair.clumpIndex)!.fileName;
    if (dff.toLowerCase() !== "rbarrel.dff") continue;
    const mts = course.instanceFiles.find((instance) => instance.index === pair.mtsIndex)!.fileName;
    const data = parseMts(await file(mts));
    expectedBarrels += data.matrices.length;
    assets.remember(dff, { kind: "dff", data: parseDff(await file(dff)) });
    assets.remember(mts, { kind: "mts", data });
  }
  const binding = assets.bind(course);
  const physics = await createPhysicsRuntime(new RuntimeEventBus(), 1 / 60, undefined, { collisionObjects: false });
  try {
    const baseline = physics.metrics.bodies;
    physics.setTrackBarrels(binding.barrels);
    const created = physics.metrics.bodies - baseline;
    for (const barrel of binding.barrels) physics.impactSceneObject(barrel.id, [0, 0, 1], true);
    const destroyed = physics.sceneObjects.filter((object) => !object.active).length;
    physics.resetDemo();
    const reset = physics.sceneObjects.filter((object) => object.active).length;
    physics.setTrackBarrels([]);
    const removed = physics.metrics.bodies === baseline;
    const accepted = expectedBarrels > 0 && created === expectedBarrels && destroyed === created && reset === created && removed;
    reports.push({ trackId: track.id, accepted, created, destroyed, reset, removed, warnings: binding.warnings });
  } finally { physics.dispose(); }
}
const accepted = reports.length > 0 && reports.every((report) => report.accepted);
console.log(JSON.stringify({ version: 1, accepted, scope: "source-barrel-binding-lifecycle", reports }, null, 2));
if (!accepted) process.exitCode = 1;
