/// <reference lib="webworker" />
import { buildImportedCatalog, collectImportFiles, type ImportProgress, type ImportSource } from "./browser-import.js";
import { ContentStore, type StoredContent } from "./content-store.js";
import { extractDiscSources } from "./disc-import.js";
import { validateImportedResource } from "./import-validation.js";

export type ImportRequest = { type: "start"; sources: ImportSource[]; sourceKind: "folder" | "disc" } | { type: "cancel" };
export type ImportResponse = { type: "progress"; progress: ImportProgress }
  | { type: "committing" }
  | { type: "complete"; manifest: StoredContent }
  | { type: "error"; error: string; cancelled: boolean };
const worker = self as DedicatedWorkerGlobalScope;
let cancelled = false;
let running = false;
function checkCancelled(): void {
  if (cancelled) throw new DOMException("Import cancelled. Select the same source again to resume.", "AbortError");
}
function send(message: ImportResponse): void { worker.postMessage(message); }

async function run(sources: ImportSource[], sourceKind: "folder" | "disc"): Promise<void> {
  if (!navigator.locks) throw new Error("This browser cannot coordinate local imports. Use a browser with Web Locks support.");
  await navigator.locks.request("mashed-content-import", { ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("Another game tab is importing content. Wait for it to finish.");
    let lastProgressAt = -Infinity;
    const report = (progress: ImportProgress): void => {
      checkCancelled();
      if (progress.unit === "bytes" && performance.now() - lastProgressAt < 75 && progress.completed < progress.total) return;
      lastProgressAt = performance.now();
      send({ type: "progress", progress });
    };
    const prepared = sourceKind === "disc" ? (await extractDiscSources(sources, report, checkCancelled)).sources : sources;
    const files = await collectImportFiles(prepared, report);
    checkCancelled();
    const catalog = await buildImportedCatalog(files);
    const store = await ContentStore.open();
    try {
      await store.prune();
      const manifest: StoredContent = { version: 1, catalog, hashes: {}, total: files.size, bytes: 0 };
      // Previously committed blobs are reused by digest, including work from an interrupted run.
      // Hash every selected payload again, so changed files with identical names/sizes cannot be reused.
      for (const [path, blob] of files) {
        checkCancelled();
        send({ type: "progress", progress: { completed: Object.keys(manifest.hashes).length, total: files.size, label: `Checking and saving ${path.split("/").at(-1)}` } });
        const buffer = await blob.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
          .map((byte) => byte.toString(16).padStart(2, "0")).join("");
        checkCancelled();
        const cached = await store.blob(hash);
        try { validateImportedResource(path, buffer); }
        catch (error) { throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
        checkCancelled();
        manifest.hashes[path] = hash;
        manifest.bytes += blob.size;
        await store.savePending(manifest, cached ? undefined : { hash, blob });
      }
      checkCancelled();
      send({ type: "committing" });
      await store.activate(manifest);
      send({ type: "complete", manifest });
    } finally { store.close(); }
  });
}

worker.onmessage = (event: MessageEvent<ImportRequest>): void => {
  if (event.data.type === "cancel") { cancelled = true; return; }
  if (running) return;
  running = true;
  void run(event.data.sources, event.data.sourceKind).catch((error: unknown) => {
    const quota = error instanceof DOMException && error.name === "QuotaExceededError";
    send({ type: "error", cancelled: error instanceof DOMException && error.name === "AbortError",
      error: quota ? "Not enough browser storage. Free disk space and select the source again to resume. Your previous library is unchanged."
        : error instanceof Error ? error.message : String(error) });
  });
};
