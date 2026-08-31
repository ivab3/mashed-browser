import { Matrix4, Quaternion, Vector3 } from "three";
import { admittedTrackByCourseId, type CourseDefinition, type DffModel, type MtsInstances } from "@mashed/assets";
import { ALPHA_BARREL_EXPLOSION, type TrackHazardDefinition, type TrackVector3 } from "@mashed/core";
import type { TrackBarrelSpec } from "@mashed/physics";
import type { LoadedAsset } from "./loading-protocol.js";

function barrelBounds(model: DffModel) {
  const frame = model.frames[0];
  if (model.frames.length !== 1 || !frame || frame.parentIndex !== -1
    || JSON.stringify([frame.right, frame.up, frame.at, frame.position]) !== JSON.stringify([
      [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0],
    ]) || model.atomics.some((atomic) => atomic.frameIndex !== 0)) {
    throw new Error("Unsupported barrel model frame layout");
  }
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const atomic of model.atomics) {
    const vertices = model.geometries[atomic.geometryIndex]?.morphTargets[0]?.positions;
    if (!vertices) throw new Error("Barrel model is missing vertices");
    for (let index = 0; index < vertices.length; index += 1) {
      const value = vertices[index]!;
      if (!Number.isFinite(value)) throw new Error("Barrel model contains non-finite vertices");
      const axis = index % 3;
      low[axis] = Math.min(low[axis]!, value);
      high[axis] = Math.max(high[axis]!, value);
    }
  }
  const size = high.map((value, axis) => (value - low[axis]!) / 2);
  if (size.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("Barrel bounds must have volume");
  const radius = Math.max(size[0]!, size[2]!);
  return {
    center: high.map((value, axis) => (value + low[axis]!) / 2) as unknown as TrackVector3,
    halfExtents: [radius, size[1]!, radius] as const,
  };
}

/** Course-scoped cache: a new COURSE bundle can never reuse another track's RBARREL.MTS. */
export class TrackHazardAssets {
  readonly #models = new Map<string, DffModel>();
  readonly #instances = new Map<string, MtsInstances>();

  clear(): void { this.#models.clear(); this.#instances.clear(); }

  remember(fileName: string, asset: LoadedAsset): void {
    const key = fileName.toLowerCase();
    if (asset.kind === "dff") this.#models.set(key, asset.data);
    if (asset.kind === "mts") this.#instances.set(key, asset.data);
  }

  bind(course: CourseDefinition) {
    const barrels: TrackBarrelSpec[] = [];
    const hazards: TrackHazardDefinition[] = [];
    const models: Array<{ id: string; model: DffModel; center: TrackVector3 }> = [];
    const warnings: string[] = [];
    if (!admittedTrackByCourseId(course.id)) {
      return { barrels, hazards, models, warnings: ["Track events are not admitted for this course"] };
    }
    for (const pair of course.explosiveObjects) {
      const dffName = course.clumps.find((clump) => clump.index === pair.clumpIndex)!.fileName;
      const mtsName = course.instanceFiles.find((file) => file.index === pair.mtsIndex)!.fileName;
      if (dffName.toLowerCase() !== "rbarrel.dff") {
        warnings.push(`${dffName}: unsupported explosive object (not a barrel)`);
        continue;
      }
      const model = this.#models.get(dffName.toLowerCase());
      const instances = this.#instances.get(mtsName.toLowerCase());
      if (!model || !instances) {
        warnings.push(`Track barrels need ${[!model && dffName, !instances && mtsName].filter(Boolean).join(" + ")}`);
        continue;
      }
      const { center, halfExtents } = barrelBounds(model);
      for (const [index, instance] of instances.matrices.entries()) {
        const basis = [instance.right, instance.up, instance.at].map((vector) => new Vector3(...vector));
        const transform = new Matrix4().makeBasis(basis[0]!, basis[1]!, basis[2]!);
        if (basis.some((vector) => Math.abs(vector.length() - 1) > 1e-4)
          || Math.abs(basis[0]!.dot(basis[1]!)) > 1e-4 || Math.abs(basis[0]!.dot(basis[2]!)) > 1e-4
          || Math.abs(basis[1]!.dot(basis[2]!)) > 1e-4 || Math.abs(transform.determinant() - 1) > 1e-4) {
          throw new Error(`${mtsName}: scaled, reflected or sheared barrel matrix ${index} is unsupported`);
        }
        transform.setPosition(...instance.position);
        const position = new Vector3(...center).applyMatrix4(transform).toArray() as [number, number, number];
        const rotation = new Quaternion().setFromRotationMatrix(transform).normalize().toArray() as [number, number, number, number];
        const id = `track-barrel:${course.id}:${pair.clumpIndex}:${pair.mtsIndex}:${index}`;
        barrels.push({ id, position, rotation, halfExtents });
        hazards.push({ id, position, ...ALPHA_BARREL_EXPLOSION });
        models.push({ id, model, center });
      }
    }
    return { barrels, hazards, models, warnings };
  }
}
