export type ContentResourceDisposition = "deferred" | "non-runtime" | "parsed-only" | "partial" | "supported";

export interface ContentResourceBoundary {
  suffix: string;
  disposition: ContentResourceDisposition;
  reason: string;
}

export interface AlphaTrackAdmission {
  id: string;
  displayName: string;
  directoryName: string;
  courseId: number;
  powerupFileName?: string;
  powerupLoadoutPath?: string;
  resourceBoundaries: readonly ContentResourceBoundary[];
}

export interface AlphaVehicleAdmission {
  id: string;
  displayName: string;
  directoryName: string;
  assetBaseName: string;
  variants: readonly number[];
  nameMapping: "exact-name" | "inferred-position";
  resourceBoundaries: readonly {
    fileNames: readonly string[];
    disposition: ContentResourceDisposition;
    reason: string;
  }[];
}

export interface AlphaContentBatch {
  id: string;
  status: "admitted";
  tracks: readonly AlphaTrackAdmission[];
  vehicles: readonly AlphaVehicleAdmission[];
}

function localTemplateBoundary(suffix: string): ContentResourceBoundary {
  return suffix === "rbarrel.dff"
    ? { suffix, disposition: "supported", reason: "Source barrel mesh and MTS transform bind to alpha explosive physics objects." }
    : { suffix, disposition: "parsed-only", reason: "The DFF parses, but its local-template transform or light behavior is not instantiated." };
}

const CITY_RESOURCE_BOUNDARIES: readonly ContentResourceBoundary[] = Object.freeze([
  {
    suffix: ".aid",
    disposition: "deferred",
    reason: "Original AI behavior table is structurally unconfirmed and does not drive the route controller.",
  },
  {
    suffix: ".anm",
    disposition: "deferred",
    reason: "Authored object and camera animation playback is not implemented.",
  },
  {
    suffix: ".mts",
    disposition: "partial",
    reason: "Matrices parse; RBARREL instances bind to alpha hazards. Other instance families remain unbound.",
  },
  {
    suffix: ".uva",
    disposition: "deferred",
    reason: "Authored UV animation playback is not implemented.",
  },
  {
    suffix: "ktcscript.lua",
    disposition: "deferred",
    reason: "Kill-the-copter scripted event is outside the admitted local match rules.",
  },
  {
    suffix: "powerups_gold.dff",
    disposition: "deferred",
    reason: "Pickup rules and placement are supported, but the original pickup DFF is not rendered.",
  },
  {
    suffix: "occluder.dff",
    disposition: "deferred",
    reason: "The source course comments this model out and the runtime has no occluder pass.",
  },
  {
    suffix: "fourlight.dff",
    disposition: "deferred",
    reason: "The model is not referenced by the admitted course definition.",
  },
  {
    suffix: "swingtyre.dff",
    disposition: "deferred",
    reason: "The model is not referenced by the admitted course definition.",
  },
  {
    suffix: "skydome.dff",
    disposition: "parsed-only",
    reason: "The DFF parses, but its local-template transform is not placed by the renderer.",
  },
  {
    suffix: "tree.dff",
    disposition: "parsed-only",
    reason: "The DFF parses, but its local-template transform is not placed by the renderer.",
  },
  {
    suffix: "rbarrel.dff",
    disposition: "supported",
    reason: "Source barrel mesh and MTS transform bind to alpha explosive physics objects.",
  },
  {
    suffix: "lights.dff",
    disposition: "parsed-only",
    reason: "The DFF parses, but original light behavior is not instantiated by the renderer.",
  },
  ...["lamposts.dff", "parkpost.dff", "gates.dff", "trafficlight.dff", "twolight.dff"].map((suffix) => ({
    suffix,
    disposition: "parsed-only" as const,
    reason: "The RWP template DFF parses, but authored object instances and MTS physics are deferred.",
  })),
  {
    suffix: ".mts.txt",
    disposition: "non-runtime",
    reason: "Extracted text sidecars are diagnostics and are not runtime inputs.",
  },
  {
    suffix: "rwdebug.log",
    disposition: "non-runtime",
    reason: "Source debug output is not a runtime resource.",
  },
]);

type VehicleResourceBoundary = AlphaVehicleAdmission["resourceBoundaries"][number];

const STANDARD_VEHICLE_VARIANTS: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5]);
const STANDARD_DEBRIS_FILES: readonly string[] = Object.freeze([
  "DEBRIS0.DFF",
  "DEBRIS1.DFF",
  "DEBRIS2.DFF",
  "DEBRIS3.DFF",
  "DEBRIS4.DFF",
  "DEBRIS5.DFF",
]);

function standardVehicleBoundaries(
  assetBaseName: string,
  options: {
    arms?: boolean;
    extras?: readonly VehicleResourceBoundary[];
  } = {},
): readonly VehicleResourceBoundary[] {
  return [
    ...(options.arms === false ? [] : [{
      fileNames: [`${assetBaseName}ARMS.DFF`],
      disposition: "deferred" as const,
      reason: "Original vehicle weapon-arm attachment behavior is not implemented.",
    }]),
    {
      fileNames: [`${assetBaseName}LIGHTS.DFF`],
      disposition: "deferred",
      reason: "Original vehicle light attachment behavior is not implemented.",
    },
    {
      fileNames: ["GHOST.DFF"],
      disposition: "deferred",
      reason: "Original ghost presentation is not implemented.",
    },
    {
      fileNames: STANDARD_DEBRIS_FILES,
      disposition: "deferred",
      reason: "Vehicle-specific debris meshes are not spawned on destruction.",
    },
    ...(options.extras ?? []),
  ];
}

function inferredVehicle(
  id: string,
  displayName: string,
  directoryName: string,
  assetBaseName: string,
  options?: Parameters<typeof standardVehicleBoundaries>[1],
): AlphaVehicleAdmission {
  return {
    id,
    displayName,
    directoryName,
    assetBaseName,
    variants: STANDARD_VEHICLE_VARIANTS,
    nameMapping: "inferred-position",
    resourceBoundaries: standardVehicleBoundaries(assetBaseName, options),
  };
}

/** Source-free admission metadata for content that has passed its Stage 6 gates. */
export const ALPHA_CONTENT_BATCHES: readonly AlphaContentBatch[] = Object.freeze([
  {
    id: "6.6a-city-wildfire",
    status: "admitted",
    tracks: [
      {
        id: "city-26",
        displayName: "City",
        directoryName: "City",
        courseId: 26,
        powerupFileName: "POWERUPS_GOLD.LUA",
        resourceBoundaries: CITY_RESOURCE_BOUNDARIES,
      },
    ],
    vehicles: [
      {
        id: "wildfire",
        displayName: "Wildfire",
        directoryName: "Wildfire",
        assetBaseName: "WILDFIRE",
        variants: [0, 1, 2, 3, 4, 5],
        nameMapping: "exact-name",
        resourceBoundaries: [
          {
            fileNames: ["WILDFIRELIGHTS.DFF"],
            disposition: "deferred",
            reason: "Original vehicle light attachment behavior is not implemented.",
          },
          {
            fileNames: ["GHOST.DFF"],
            disposition: "deferred",
            reason: "Original ghost presentation is not implemented.",
          },
          {
            fileNames: [
              "DEBRIS0.DFF",
              "DEBRIS1.DFF",
              "DEBRIS2.DFF",
              "DEBRIS3.DFF",
              "DEBRIS4.DFF",
              "DEBRIS5.DFF",
            ],
            disposition: "deferred",
            reason: "Vehicle-specific debris meshes are not spawned on destruction.",
          },
        ],
      },
    ],
  },
  {
    id: "6.6b-neustein-crusader",
    status: "admitted",
    tracks: [
      {
        id: "neustein-39",
        displayName: "Neustein",
        directoryName: "Neustein",
        courseId: 39,
        powerupLoadoutPath: "Common/POWERUPS/Powerups/POWERUPS_ALL.LUA",
        resourceBoundaries: [
          {
            suffix: ".anm",
            disposition: "deferred",
            reason: "Authored object and camera animation playback is not implemented.",
          },
          {
            suffix: ".mts",
            disposition: "partial",
            reason: "Matrices parse; RBARREL instances bind to alpha hazards. Other instance families remain unbound.",
          },
          {
            suffix: "powerups_gold.dff",
            disposition: "deferred",
            reason: "The original pickup DFF is not rendered; course 39 uses the shared loadout table.",
          },
          {
            suffix: "post_01.dff",
            disposition: "deferred",
            reason: "The model is not referenced by the admitted course definition.",
          },
          ...[
            "skydome_01.dff",
            "skydome_02.dff",
            "trunk.dff",
            "rbarrel.dff",
            "post_1.dff",
            "trolly_1.dff",
            "cablecar.dff",
            "lights.dff",
          ].map(localTemplateBoundary),
          {
            suffix: ".mts.txt",
            disposition: "non-runtime",
            reason: "Extracted text sidecars are diagnostics and are not runtime inputs.",
          },
        ],
      },
    ],
    vehicles: [
      {
        id: "crusader",
        displayName: "Bahnstormer",
        directoryName: "Crusader",
        assetBaseName: "CRUSADER",
        variants: [0, 1, 2, 3, 4, 5],
        nameMapping: "inferred-position",
        resourceBoundaries: [
          {
            fileNames: ["CRUSADERARMS.DFF"],
            disposition: "deferred",
            reason: "Original vehicle weapon-arm attachment behavior is not implemented.",
          },
          {
            fileNames: ["CRUSADERLIGHTS.DFF"],
            disposition: "deferred",
            reason: "Original vehicle light attachment behavior is not implemented.",
          },
          {
            fileNames: ["GHOST.DFF"],
            disposition: "deferred",
            reason: "Original ghost presentation is not implemented.",
          },
          {
            fileNames: [
              "DEBRIS0.DFF",
              "DEBRIS1.DFF",
              "DEBRIS2.DFF",
              "DEBRIS3.DFF",
              "DEBRIS4.DFF",
              "DEBRIS5.DFF",
            ],
            disposition: "deferred",
            reason: "Vehicle-specific debris meshes are not spawned on destruction.",
          },
        ],
      },
    ],
  },
  {
    id: "6.6c-arctic-shorty",
    status: "admitted",
    tracks: [
      {
        id: "arctic-0",
        displayName: "Arctic",
        directoryName: "Arctic",
        courseId: 0,
        powerupFileName: "POWERUPS_GOLD.LUA",
        resourceBoundaries: [
          {
            suffix: ".anm",
            disposition: "deferred",
            reason: "Authored helicopter and KTC animation playback is not implemented.",
          },
          {
            suffix: "ktcscript.lua",
            disposition: "deferred",
            reason: "Kill-the-copter scripted event is outside the admitted local match rules.",
          },
          {
            suffix: ".mts",
            disposition: "partial",
            reason: "Matrices parse; RBARREL instances bind to alpha hazards. Other instance families remain unbound.",
          },
          {
            suffix: ".uva",
            disposition: "deferred",
            reason: "Authored sea and sky UV animation playback is not implemented.",
          },
          {
            suffix: ".spl",
            disposition: "deferred",
            reason: "Authored wave spline animation is not implemented.",
          },
          {
            suffix: "powerups_gold.dff",
            disposition: "deferred",
            reason: "Pickup rules and placement are supported, but the original pickup DFF is not rendered.",
          },
          ...[
            "crate02.dff",
            "fishingboat.dff",
            "lights.dff",
            "mist.dff",
            "rbarrel.dff",
            "redtyre.dff",
            "sky.dff",
            "wall3.dff",
            "whitetyre.dff",
          ].map(localTemplateBoundary),
        ],
      },
    ],
    vehicles: [
      {
        id: "shorty",
        displayName: "Ruckus",
        directoryName: "Shorty",
        assetBaseName: "SHORTY",
        variants: [0, 1, 2, 3, 4, 5],
        nameMapping: "inferred-position",
        resourceBoundaries: [
          {
            fileNames: ["SHORTYARMS.DFF"],
            disposition: "deferred",
            reason: "Original vehicle weapon-arm attachment behavior is not implemented.",
          },
          {
            fileNames: ["SHORTYLIGHTS.DFF"],
            disposition: "deferred",
            reason: "Original vehicle light attachment behavior is not implemented.",
          },
          {
            fileNames: ["GHOST.DFF"],
            disposition: "deferred",
            reason: "Original ghost presentation is not implemented.",
          },
          {
            fileNames: [
              "DEBRIS0.DFF",
              "DEBRIS1.DFF",
              "DEBRIS2.DFF",
              "DEBRIS3.DFF",
              "DEBRIS4.DFF",
              "DEBRIS5.DFF",
            ],
            disposition: "deferred",
            reason: "Vehicle-specific debris meshes are not spawned on destruction.",
          },
        ],
      },
    ],
  },
  {
    id: "6.6d-complete-vehicle-roster",
    status: "admitted",
    tracks: [],
    vehicles: [
      inferredVehicle("shuriken", "Hammerhead", "Shuriken", "SHURIKEN"),
      inferredVehicle("advantage", "Shuriken", "Advantag", "ADVANTAGE", {
        extras: [{
          fileNames: ["ADVANTAGE0SLT.DFF", "ADVANTAGE0SM.DFF"],
          disposition: "deferred",
          reason: "Alternate non-numbered presentation meshes are outside the admitted skin contract.",
        }],
      }),
      inferredVehicle("atmos", "Thunderstrike", "Atmos", "ATMOS"),
      inferredVehicle("stallion", "Venom", "Stallion", "STALLION"),
      inferredVehicle("bullet", "Nemesis", "Bullet", "BULLET"),
      inferredVehicle("sputter", "Banshee", "Sputter", "SPUTTER"),
      inferredVehicle("cooler", "Miglia", "Cooler", "COOLER"),
      inferredVehicle("creeper", "Switchblade", "Creeper", "CREEPER"),
      inferredVehicle("bambam", "Genesis", "BamBam", "BAMBAM"),
      inferredVehicle("kustom", "Hurricane", "Kustom", "KUSTOM"),
      inferredVehicle("formula", "Imperial", "Formula", "FORMULA"),
      inferredVehicle("bigboss", "Slugger", "BigBoss", "BIGBOSS", { arms: false }),
    ],
  },
  {
    id: "6.6e-warzone-baseline",
    status: "admitted",
    tracks: [
      {
        id: "warzone-33",
        displayName: "Warzone",
        directoryName: "Warzone",
        courseId: 33,
        powerupLoadoutPath: "Common/POWERUPS/Powerups/POWERUPS_ALL.LUA",
        resourceBoundaries: [
          {
            suffix: ".anm",
            disposition: "deferred",
            reason: "Authored boat, helicopter, and unused animation playback is not implemented.",
          },
          {
            suffix: ".mts",
            disposition: "partial",
            reason: "Matrices parse; RBARREL instances bind to alpha hazards. Other instance families remain unbound.",
          },
          {
            suffix: "powerups_gold.dff",
            disposition: "deferred",
            reason: "The original pickup DFF is not rendered; course 33 uses the shared loadout table.",
          },
          {
            suffix: "ads.dff",
            disposition: "deferred",
            reason: "The course definition comments out this model reference.",
          },
          ...[
            "block.dff",
            "chunk.dff",
            "cross.dff",
            "crosstree.dff",
            "deck.dff",
            "fade_5.dff",
            "fade_6.dff",
            "fence_2.dff",
            "hordome.dff",
            "hstone.dff",
            "hut01.dff",
            "intactroof.dff",
            "lights.dff",
            "oaktrunk.dff",
            "post_a.dff",
            "pylon_h.dff",
            "pylon_l.dff",
            "rbarrel.dff",
            "skydome.dff",
            "tower.dff",
          ].map(localTemplateBoundary),
          {
            suffix: ".mts.txt",
            disposition: "non-runtime",
            reason: "Extracted text sidecars are diagnostics and are not runtime inputs.",
          },
        ],
      },
    ],
    vehicles: [],
  },
]);

export function alphaContentBatch(id: string): AlphaContentBatch | undefined {
  return ALPHA_CONTENT_BATCHES.find((batch) => batch.id === id);
}

export function admittedTrackByCourseId(courseId: number): AlphaTrackAdmission | undefined {
  return ALPHA_CONTENT_BATCHES.flatMap((batch) => batch.tracks)
    .find((track) => track.courseId === courseId);
}

export function admittedVehicleByAssetName(assetName: string): AlphaVehicleAdmission | undefined {
  const normalized = assetName.toLocaleUpperCase("en-US");
  return ALPHA_CONTENT_BATCHES.flatMap((batch) => batch.vehicles)
    .find((vehicle) => vehicle.assetBaseName.toLocaleUpperCase("en-US") === normalized);
}
