import {
  parseAiData, parseBspWorld, parseCourseLua, parseDff, parseLapDataLua, parseLedData,
  parseMts, parsePiTextureDictionary, parsePowerupPlacementsLua, parseRwsSoundDictionary,
  parseTrackPowerupLoadoutsLua,
} from "@mashed/assets";

/** Use production readers before publishing a library; source Lua is never executed. */
export function validateImportedResource(path: string, buffer: ArrayBuffer): void {
  if (path.endsWith(".bsp")) parseBspWorld(buffer);
  else if (path.endsWith(".dff")) parseDff(buffer);
  else if (path.endsWith(".txd")) parsePiTextureDictionary(buffer);
  else if (path.endsWith(".mts")) parseMts(buffer);
  else if (path.endsWith(".rws")) parseRwsSoundDictionary(buffer);
  else if (path.endsWith(".ai")) parseAiData(buffer);
  else if (path.endsWith(".led")) parseLedData(buffer);
  else if (path.endsWith(".lua")) {
    const text = new TextDecoder().decode(buffer);
    if (path.endsWith("/course.lua")) parseCourseLua(text);
    else if (path.endsWith("/lapdata.lua")) parseLapDataLua(text);
    else if (path.endsWith("/powerups_gold.lua")) parsePowerupPlacementsLua(text);
    else if (path.endsWith("/powerups_all.lua")) parseTrackPowerupLoadoutsLua(text);
  }
}
