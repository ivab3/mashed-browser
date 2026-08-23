import type {
  AssetKind,
  LoadAssetRequest,
  LoadAssetResponse,
  LoadedAsset,
} from "./loading-protocol.js";

export interface AssetLoadResult {
  asset: LoadedAsset;
  parseMilliseconds: number;
  transferredBytes: number;
}

interface PendingRequest {
  resolve: (result: AssetLoadResult) => void;
  reject: (error: Error) => void;
}

function assetKind(fileName: string): AssetKind {
  const extension = fileName.split(".").pop()?.toLocaleLowerCase("en-US");
  if (extension === "dff" || extension === "txd" || extension === "bsp") {
    return extension;
  }
  throw new Error(`Unsupported asset extension in ${fileName}`);
}

export class AssetLoadingClient {
  readonly #worker = new Worker(new URL("./loading.worker.ts", import.meta.url), { type: "module" });
  readonly #pending = new Map<number, PendingRequest>();
  #nextId = 1;

  constructor() {
    this.#worker.onmessage = (message: MessageEvent<LoadAssetResponse>): void => {
      const response = message.data;
      const pending = this.#pending.get(response.id);
      if (!pending) {
        return;
      }
      this.#pending.delete(response.id);
      if (response.ok) {
        pending.resolve({
          asset: response.asset,
          parseMilliseconds: response.parseMilliseconds,
          transferredBytes: response.transferredBytes,
        });
      } else {
        pending.reject(new Error(response.error));
      }
    };
    this.#worker.onerror = (event): void => {
      const error = new Error(event.message || "Asset loading Worker failed");
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
    };
  }

  async load(file: File): Promise<AssetLoadResult> {
    const buffer = await file.arrayBuffer();
    const id = this.#nextId;
    this.#nextId += 1;
    const request: LoadAssetRequest = { id, kind: assetKind(file.name), buffer };
    return new Promise<AssetLoadResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage(request, [buffer]);
    });
  }

  dispose(): void {
    this.#worker.terminate();
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("Asset loading client disposed"));
    }
    this.#pending.clear();
  }
}
