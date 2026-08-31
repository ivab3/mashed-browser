import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { deriveTrackDefinition, parseBspWorld, parseCourseLua, parseLapDataLua } from "@mashed/assets";

/** Resolves declared source names case-insensitively, including Arctic's nonstandard BSP names. */
export async function loadLapValidationData(directory: string) {
  const files = await readdir(directory);
  const read = async (requested: string) => {
    const actual = files.find((file) => file.toLowerCase() === requested.toLowerCase());
    if (!actual) throw new Error(`${directory} is missing ${requested}`);
    return readFile(resolve(directory, actual));
  };
  const course = parseCourseLua((await read("COURSE.LUA")).toString("utf8"));
  if (!course.aiBspFileName || !course.collisionBspFileName) {
    throw new Error("Lap validation requires declared AI and collision BSP filenames");
  }
  return {
    course: deriveTrackDefinition(
      parseBspWorld(await read(course.aiBspFileName)),
      parseLapDataLua((await read("LAPDATA.LUA")).toString("utf8")),
    ),
    collision: parseBspWorld(await read(course.collisionBspFileName)),
  };
}
