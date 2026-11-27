import type { CourseDefinition } from "@mashed/assets";
import type { LocalContentFile } from "./local-content-catalog.js";

export type TrackBspRole = "ai" | "collision" | "graphics";

export interface DeclaredTrackBsp {
  role: TrackBspRole;
  fileName: string;
}

export function declaredTrackBsps(course: CourseDefinition): readonly DeclaredTrackBsp[] {
  return [
    ...(course.aiBspFileName ? [{ role: "ai" as const, fileName: course.aiBspFileName }] : []),
    ...(course.collisionBspFileName
      ? [{ role: "collision" as const, fileName: course.collisionBspFileName }]
      : []),
    ...(course.worldBspFileName
      ? [{ role: "graphics" as const, fileName: course.worldBspFileName }]
      : []),
  ];
}

/** Uses COURSE.LUA declarations first, then legacy conventions for bundles without course metadata. */
export function trackBspRole(fileName: string, course?: CourseDefinition): TrackBspRole | undefined {
  const normalized = fileName.toLocaleLowerCase("en-US");
  const declared = course && declaredTrackBsps(course).find((entry) => (
    entry.fileName.toLocaleLowerCase("en-US") === normalized
  ));
  if (declared) {
    return declared.role;
  }
  if (!course?.aiBspFileName && /^ai\d*\.bsp$/.test(normalized)) {
    return "ai";
  }
  if (!course?.collisionBspFileName && /collid/.test(normalized)) {
    return "collision";
  }
  if (!course?.worldBspFileName && /graphics|world/.test(normalized)) {
    return "graphics";
  }
  return undefined;
}

export function courseModelNames(course: CourseDefinition): Set<string> {
  return new Set([
    ...course.clumps.map((clump) => clump.fileName),
    ...course.skies.map((sky) => sky.fileName),
    ...(course.lightsFileName ? [course.lightsFileName] : []),
  ].map((name) => name.toLowerCase()));
}

/** COURSE.LUA has already been read. Request only files the current track runtime consumes. */
export function playableTrackFiles(files: readonly LocalContentFile[], course?: CourseDefinition): LocalContentFile[] {
  const models = course && courseModelNames(course);
  const instances = course && new Set(course.explosiveObjects.map(({ mtsIndex }) =>
    course.instanceFiles.find((entry) => entry.index === mtsIndex)?.fileName.toLowerCase()
  ));
  return files.filter(({ name }) => {
    const key = name.toLowerCase();
    if (key.endsWith(".dff")) return !models || models.has(key);
    if (key.endsWith(".mts")) return !instances || instances.has(key);
    if (key.endsWith(".bsp")) return trackBspRole(name, course) !== undefined;
    if (key.endsWith(".txd")) return !course?.textureDictionaryFileName || key === course.textureDictionaryFileName.toLowerCase();
    return /\.(ai|led)$/.test(key) || /^(lapdata|powerups?_(gold|all))\.lua$/.test(key);
  });
}
