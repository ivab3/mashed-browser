import type { BspWorld, DffModel, MtsInstances, PiTextureDictionary, RwsSoundDictionary } from "@mashed/assets";

export type AssetKind = "dff" | "txd" | "bsp" | "rws" | "mts";

export type LoadedAsset =
  | { kind: "mts"; data: MtsInstances }
  | { kind: "dff"; data: DffModel }
  | { kind: "txd"; data: PiTextureDictionary }
  | { kind: "bsp"; data: BspWorld }
  | { kind: "rws"; data: RwsSoundDictionary };

export interface LoadAssetRequest {
  id: number;
  kind: AssetKind;
  buffer: ArrayBuffer;
}

export type LoadAssetResponse =
  | {
      id: number;
      ok: true;
      asset: LoadedAsset;
      parseMilliseconds: number;
      transferredBytes: number;
    }
  | {
      id: number;
      ok: false;
      error: string;
    };
