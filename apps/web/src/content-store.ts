import type { LocalContentCatalog } from "./local-content-catalog.js";

export interface StoredContent {
  version: 1;
  catalog: LocalContentCatalog;
  hashes: Record<string, string>;
  total: number;
  bytes: number;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser storage request failed"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Browser storage transaction was aborted"));
    transaction.onerror = () => { /* onabort supplies the final transaction outcome */ };
  });
}

/** Content-addressed blobs and atomic active/pending manifests, independent of gameplay saves. */
export class ContentStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<ContentStore> {
    if (typeof indexedDB === "undefined") throw new Error("Browser storage is unavailable");
    const request = indexedDB.open("mashed-local-content", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("blobs");
      request.result.createObjectStore("manifests");
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Cannot open browser storage"));
      request.onblocked = () => reject(new Error("Close other game tabs to update browser storage"));
    });
    db.onversionchange = () => db.close();
    return new ContentStore(db);
  }

  close(): void { this.db.close(); }

  async manifest(key: "active" | "pending"): Promise<StoredContent | undefined> {
    const value = await result(this.db.transaction("manifests").objectStore("manifests").get(key)) as StoredContent | undefined;
    if (value && (value.version !== 1 || value.catalog?.version !== 1 || !value.hashes)) {
      throw new Error("Unsupported saved content version. Import your game folder again.");
    }
    return value;
  }

  async blob(hash: string): Promise<Blob | undefined> {
    return result(this.db.transaction("blobs").objectStore("blobs").get(hash)) as Promise<Blob | undefined>;
  }

  async savePending(manifest: StoredContent, payload?: { hash: string; blob: Blob }): Promise<void> {
    const tx = this.db.transaction(["manifests", "blobs"], "readwrite");
    const done = complete(tx);
    if (payload) tx.objectStore("blobs").put(payload.blob, payload.hash);
    tx.objectStore("manifests").put(manifest, "pending");
    await done;
  }

  async activate(manifest: StoredContent): Promise<void> {
    if (Object.keys(manifest.hashes).length !== manifest.total) throw new Error("Import is incomplete");
    const tx = this.db.transaction("manifests", "readwrite");
    const done = complete(tx);
    tx.objectStore("manifests").put(manifest, "active");
    tx.objectStore("manifests").delete("pending");
    await done;
  }

  /** Called under the cross-tab import lock. Keep the current library and resumable work. */
  async prune(): Promise<void> {
    const [active, pending] = await Promise.all([this.manifest("active"), this.manifest("pending")]);
    const keep = new Set([...Object.values(active?.hashes ?? {}), ...Object.values(pending?.hashes ?? {})]);
    const tx = this.db.transaction("blobs", "readwrite");
    const done = complete(tx);
    const cursor = tx.objectStore("blobs").openKeyCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (!entry) return;
      if (!keep.has(String(entry.key))) tx.objectStore("blobs").delete(entry.key);
      entry.continue();
    };
    await done;
  }
}

export async function readCachedContentFile(manifest: StoredContent, path: string, name: string): Promise<File> {
  const hash = manifest.hashes[path];
  if (!hash) throw new Error(`Resource is missing from the saved library: ${name}. Import the folder again.`);
  const store = await ContentStore.open();
  try {
    const blob = await store.blob(hash);
    if (!blob) throw new Error(`Saved resource is unavailable: ${name}. Reload or import the folder again.`);
    return new File([blob], name);
  } finally { store.close(); }
}
