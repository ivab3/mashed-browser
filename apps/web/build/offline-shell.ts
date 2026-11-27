import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export function offlineShellPlugin(): Plugin {
  return {
    name: "mashed-offline-shell",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        const entries: Record<string, string> = {};
        const add = (path: string, bytes: string | Uint8Array): void => {
          entries[path] = "sha256-" + createHash("sha256").update(bytes).digest("base64");
        };
        for (const output of Object.values(bundle)) {
          if (output.fileName === "index.html" || output.fileName.startsWith("assets/") && !output.fileName.endsWith(".map")) {
            add(output.fileName, output.type === "chunk" ? output.code : output.source);
          }
        }
        for (const path of ["manifest.webmanifest", "icon-192.png", "icon-512.png"]) {
          add(path, readFileSync(resolve(this.environment.config.publicDir, path)));
        }
        const template = readFileSync(new URL("./service-worker.js", import.meta.url), "utf8");
        const files = JSON.stringify(Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))));
        const revision = createHash("sha256").update(template).update(files).digest("hex").slice(0, 24);
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: template.replace("__SHELL_REVISION__", revision).replace("__SHELL_FILES__", files),
        });
      },
    },
  };
}
