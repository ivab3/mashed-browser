import type { ImportProgress } from "./browser-import.js";
import type { StoredContent } from "./content-store.js";
import type { ImportRequest, ImportResponse } from "./import.worker.js";

export function importGameSource(
  files: readonly File[], sourceKind: "folder" | "disc", onProgress: (value: ImportProgress) => void, onCommit: () => void,
): { result: Promise<StoredContent>; cancel: () => void } {
  const worker = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module" });
  const result = new Promise<StoredContent>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ImportResponse>) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message.progress);
      else if (message.type === "committing") onCommit();
      else {
        worker.terminate();
        if (message.type === "complete") resolve(message.manifest);
        else reject(new DOMException(message.error, message.cancelled ? "AbortError" : "OperationError"));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Import Worker failed. Select the source again to resume."));
    };
    const request: ImportRequest = { type: "start", sourceKind, sources: files.map((file) => ({ path: file.webkitRelativePath || file.name, blob: file })) };
    worker.postMessage(request);
  });
  return { result, cancel: () => worker.postMessage({ type: "cancel" } satisfies ImportRequest) };
}

export function importGameFolder(
  files: readonly File[], onProgress: (value: ImportProgress) => void, onCommit: () => void,
): ReturnType<typeof importGameSource> {
  return importGameSource(files, "folder", onProgress, onCommit);
}
