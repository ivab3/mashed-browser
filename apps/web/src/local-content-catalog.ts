export interface LocalContentFile {
  readonly name: string;
  readonly url: string;
}

export interface LocalTrackCatalogEntry {
  readonly id: string;
  readonly displayName: string;
  readonly courseId: number;
  readonly previewTextureName: string;
  readonly available: boolean;
  readonly files: readonly LocalContentFile[];
}

export interface LocalVehicleVariant {
  readonly variant: number;
  readonly model: LocalContentFile;
}

export interface LocalVehicleCatalogEntry {
  readonly id: string;
  readonly displayName: string;
  readonly assetBaseName: string;
  readonly previewTextureName: string;
  readonly available: boolean;
  readonly texture?: LocalContentFile;
  readonly variants: readonly LocalVehicleVariant[];
}

export interface LocalContentCatalog {
  readonly version: 1;
  readonly previewDictionary?: LocalContentFile;
  readonly tracks: readonly LocalTrackCatalogEntry[];
  readonly vehicles: readonly LocalVehicleCatalogEntry[];
}

export interface LocalTrackSource {
  readonly id: string;
  readonly displayName: string;
  readonly directoryName: string;
  readonly courseId: number;
  readonly previewTextureName: string;
  readonly powerupLoadoutPath?: string;
}

export interface LocalVehicleSource {
  readonly id: string;
  readonly displayName: string;
  readonly directoryName: string;
  readonly assetBaseName: string;
  readonly previewTextureName: string;
  readonly variants: readonly number[];
}

/**
 * Source-free menu metadata for the content already admitted by Stage 6. File
 * availability comes from imported browser storage or the ignored development game-data tree.
 */
export const LOCAL_TRACK_SOURCES: readonly LocalTrackSource[] = Object.freeze([
  { id: "city-26", displayName: "City", directoryName: "City", courseId: 26, previewTextureName: "City-at-Night1" },
  {
    id: "neustein-39",
    displayName: "Neustein",
    directoryName: "Neustein",
    courseId: 39,
    previewTextureName: "Neustein1",
    powerupLoadoutPath: "Common/POWERUPS/Powerups/POWERUPS_ALL.LUA",
  },
  { id: "arctic-0", displayName: "Arctic", directoryName: "Arctic", courseId: 0, previewTextureName: "Timgidski1" },
  {
    id: "warzone-33",
    displayName: "Warzone",
    directoryName: "Warzone",
    courseId: 33,
    previewTextureName: "Nukov1",
    powerupLoadoutPath: "Common/POWERUPS/Powerups/POWERUPS_ALL.LUA",
  },
]);

const STANDARD_VARIANTS: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5]);

export const LOCAL_VEHICLE_SOURCES: readonly LocalVehicleSource[] = Object.freeze([
  { id: "shuriken", displayName: "Hammerhead", directoryName: "Shuriken", assetBaseName: "SHURIKEN", previewTextureName: "car1", variants: STANDARD_VARIANTS },
  { id: "advantage", displayName: "Shuriken", directoryName: "Advantag", assetBaseName: "ADVANTAGE", previewTextureName: "car2", variants: STANDARD_VARIANTS },
  { id: "atmos", displayName: "Thunderstrike", directoryName: "Atmos", assetBaseName: "ATMOS", previewTextureName: "car3", variants: STANDARD_VARIANTS },
  { id: "stallion", displayName: "Venom", directoryName: "Stallion", assetBaseName: "STALLION", previewTextureName: "car4", variants: STANDARD_VARIANTS },
  { id: "bullet", displayName: "Nemesis", directoryName: "Bullet", assetBaseName: "BULLET", previewTextureName: "car5", variants: STANDARD_VARIANTS },
  { id: "sputter", displayName: "Banshee", directoryName: "Sputter", assetBaseName: "SPUTTER", previewTextureName: "car6", variants: STANDARD_VARIANTS },
  { id: "cooler", displayName: "Miglia", directoryName: "Cooler", assetBaseName: "COOLER", previewTextureName: "car7", variants: STANDARD_VARIANTS },
  { id: "shorty", displayName: "Ruckus", directoryName: "Shorty", assetBaseName: "SHORTY", previewTextureName: "car8", variants: STANDARD_VARIANTS },
  { id: "crusader", displayName: "Bahnstormer", directoryName: "Crusader", assetBaseName: "CRUSADER", previewTextureName: "car9", variants: STANDARD_VARIANTS },
  { id: "creeper", displayName: "Switchblade", directoryName: "Creeper", assetBaseName: "CREEPER", previewTextureName: "car10", variants: STANDARD_VARIANTS },
  { id: "bambam", displayName: "Genesis", directoryName: "BamBam", assetBaseName: "BAMBAM", previewTextureName: "car11", variants: STANDARD_VARIANTS },
  { id: "kustom", displayName: "Hurricane", directoryName: "Kustom", assetBaseName: "KUSTOM", previewTextureName: "car12", variants: STANDARD_VARIANTS },
  { id: "formula", displayName: "Imperial", directoryName: "Formula", assetBaseName: "FORMULA", previewTextureName: "car13", variants: STANDARD_VARIANTS },
  { id: "wildfire", displayName: "Wildfire", directoryName: "Wildfire", assetBaseName: "WILDFIRE", previewTextureName: "car14", variants: STANDARD_VARIANTS },
  { id: "bigboss", displayName: "Slugger", directoryName: "BigBoss", assetBaseName: "BIGBOSS", previewTextureName: "car15", variants: STANDARD_VARIANTS },
]);
