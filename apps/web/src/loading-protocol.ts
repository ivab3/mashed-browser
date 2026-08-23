import type { BspWorld, DffModel, PiTextureDictionary } from "@mashed/assets";

export type AssetKind = "dff" | "txd" | "bsp";

export type LoadedAsset =
  | { kind: "dff"; data: DffModel }
  | { kind: "txd"; data: PiTextureDictionary }
  | { kind: "bsp"; data: BspWorld };

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
