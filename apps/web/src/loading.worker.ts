/// <reference lib="webworker" />

import {
  parseBspWorld,
  parseDff,
  parsePiTextureDictionary,
  parseRwsSoundDictionary,
} from "@mashed/assets";

import type {
  LoadAssetRequest,
  LoadAssetResponse,
  LoadedAsset,
} from "./loading-protocol.js";
import { transferablesIn } from "./transferables.js";

const worker = self as DedicatedWorkerGlobalScope;

worker.onmessage = (message: MessageEvent<LoadAssetRequest>): void => {
  const request = message.data;
  try {
    const startedAt = performance.now();
    let asset: LoadedAsset;
    switch (request.kind) {
      case "dff":
        asset = { kind: "dff", data: parseDff(request.buffer) };
        break;
      case "txd":
        asset = { kind: "txd", data: parsePiTextureDictionary(request.buffer) };
        break;
      case "bsp":
        asset = { kind: "bsp", data: parseBspWorld(request.buffer) };
        break;
      case "rws":
        asset = { kind: "rws", data: parseRwsSoundDictionary(request.buffer) };
        break;
    }
    const transfer = transferablesIn(asset);
    const response: LoadAssetResponse = {
      id: request.id,
      ok: true,
      asset,
      parseMilliseconds: performance.now() - startedAt,
      transferredBytes: transfer.reduce((total, buffer) => total + buffer.byteLength, 0),
    };
    worker.postMessage(response, { transfer });
  } catch (error) {
    const response: LoadAssetResponse = {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    worker.postMessage(response);
  }
};
