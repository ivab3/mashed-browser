import type { CourseDefinition } from "@mashed/assets";

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
  if (/^ai\d*\.bsp$/.test(normalized)) {
    return "ai";
  }
  if (/collid/.test(normalized)) {
    return "collision";
  }
  if (/graphics|world/.test(normalized)) {
    return "graphics";
  }
  return undefined;
}
