export interface VehicleDffName {
  fileName: string;
  vehicleName: string;
  variant: number;
  textureDictionaryFileName: string;
}

export interface VehicleAssetPair extends VehicleDffName {
  textureFileName: string;
}

/** Recognizes the NAME0.DFF … NAME5.DFF convention used by Mashed vehicle skins. */
export function parseVehicleDffName(fileName: string): VehicleDffName | undefined {
  const match = fileName.match(/^(.+?)([0-5])\.dff$/i);
  const vehicleName = match?.[1];
  const variant = match?.[2];
  if (!vehicleName || variant === undefined) {
    return undefined;
  }
  return {
    fileName,
    vehicleName,
    variant: Number(variant),
    textureDictionaryFileName: `${vehicleName}.txd`,
  };
}

/** Selects a loaded DFF/TXD vehicle pair, preferring player/skin variant zero. */
export function selectVehicleAssetPair(
  dffFileNames: Iterable<string>,
  textureFileNames: Iterable<string>,
): VehicleAssetPair | undefined {
  const textures = new Map(
    [...textureFileNames].map((fileName) => [fileName.toLocaleLowerCase("en-US"), fileName]),
  );
  return [...dffFileNames]
    .flatMap((fileName) => {
      const vehicle = parseVehicleDffName(fileName);
      if (!vehicle) {
        return [];
      }
      const textureFileName = textures.get(
        vehicle.textureDictionaryFileName.toLocaleLowerCase("en-US"),
      );
      return textureFileName ? [{ ...vehicle, textureFileName }] : [];
    })
    .sort((left, right) => left.variant - right.variant
      || left.vehicleName.localeCompare(right.vehicleName, "en-US"))[0];
}
