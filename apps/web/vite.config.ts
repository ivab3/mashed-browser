import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import { offlineShellPlugin } from "./build/offline-shell.js";

import {
  LOCAL_TRACK_SOURCES,
  LOCAL_VEHICLE_SOURCES,
  type LocalContentCatalog,
  type LocalContentFile,
} from "./src/local-content-catalog.js";

const appDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = resolve(appDirectory, "../..");
const gameDataDirectory = resolve(workspaceDirectory, "game-data");
const expandedDirectory = resolve(gameDataDirectory, "expanded/piz/TOASTART");
const localContentPrefix = "/__mashed/game-data/";
const catalogPath = "/__mashed/catalog.json";
const runtimeExtensions = new Set([".bsp", ".dff", ".lua", ".mts", ".txd"]);

function gameDataUrl(path: string): string {
  const localPath = relative(gameDataDirectory, path).split(sep).map(encodeURIComponent).join("/");
  return `${localContentPrefix}${localPath}`;
}

function contentFile(path: string): LocalContentFile {
  return { name: path.split(sep).at(-1) ?? path, url: gameDataUrl(path) };
}

function existingFile(path: string): LocalContentFile | undefined {
  return existsSync(path) && statSync(path).isFile() ? contentFile(path) : undefined;
}

function trackFiles(directoryName: string, courseId: number, powerupLoadoutPath?: string): LocalContentFile[] {
  const directory = resolve(expandedDirectory, "TRACKS", directoryName);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    return [];
  }
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && runtimeExtensions.has(extname(entry.name).toLocaleLowerCase("en-US")))
    .map((entry) => contentFile(resolve(directory, entry.name)));
  for (const optionalPath of [
    resolve(expandedDirectory, "Common", "AI", `AI${courseId}.AI`),
    resolve(expandedDirectory, "Common", "LED", `LE${courseId}.LED`),
    ...(powerupLoadoutPath ? [resolve(expandedDirectory, powerupLoadoutPath)] : []),
    resolve(gameDataDirectory, "files/toastaudio/pc/audio/pcdics/permdict.rws"),
  ]) {
    const file = existingFile(optionalPath);
    if (file) {
      files.push(file);
    }
  }
  return files;
}

function localCatalog(): LocalContentCatalog {
  const previewDictionary = existingFile(resolve(expandedDirectory, "Common/SFX/TRACKIMAGES.TXD"));
  return {
    version: 1,
    ...(previewDictionary ? { previewDictionary } : {}),
    tracks: LOCAL_TRACK_SOURCES.map((track) => {
      const files = trackFiles(track.directoryName, track.courseId, track.powerupLoadoutPath);
      return {
        id: track.id,
        displayName: track.displayName,
        courseId: track.courseId,
        previewTextureName: track.previewTextureName,
        available: files.length > 0,
        files,
      };
    }),
    vehicles: LOCAL_VEHICLE_SOURCES.map((vehicle) => {
      const directory = resolve(expandedDirectory, "VEHICLES", vehicle.directoryName);
      const texture = existingFile(resolve(directory, `${vehicle.assetBaseName}.TXD`));
      const variants = vehicle.variants.flatMap((variant) => {
        const model = existingFile(resolve(directory, `${vehicle.assetBaseName}${variant}.DFF`));
        return model ? [{ variant, model }] : [];
      });
      return {
        id: vehicle.id,
        displayName: vehicle.displayName,
        assetBaseName: vehicle.assetBaseName,
        previewTextureName: vehicle.previewTextureName,
        available: texture !== undefined && variants.length > 0,
        ...(texture ? { texture } : {}),
        variants,
      };
    }),
  };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function serveLocalContent(request: IncomingMessage, response: ServerResponse): boolean {
  const requestUrl = new URL(request.url ?? "/", "http://localhost");
  if (requestUrl.pathname === catalogPath) {
    sendJson(response, 200, localCatalog());
    return true;
  }
  if (!requestUrl.pathname.startsWith(localContentPrefix)) {
    return false;
  }
  const encodedPath = requestUrl.pathname.slice(localContentPrefix.length);
  let filePath: string;
  try {
    filePath = resolve(gameDataDirectory, encodedPath.split("/").map(decodeURIComponent).join(sep));
  } catch {
    sendJson(response, 400, { error: "Malformed local asset path" });
    return true;
  }
  if (!filePath.startsWith(`${gameDataDirectory}${sep}`) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(response, 404, { error: "Local asset not found" });
    return true;
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/octet-stream");
  response.setHeader("Content-Length", statSync(filePath).size);
  response.setHeader("Cache-Control", "private, max-age=3600");
  createReadStream(filePath).pipe(response);
  return true;
}

function localContentPlugin(): Plugin {
  const configure = (middlewares: { use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): void }) => {
    middlewares.use((request, response, next) => {
      if (!serveLocalContent(request, response)) {
        next();
      }
    });
  };
  return {
    name: "mashed-local-content",
    configureServer(server) {
      configure(server.middlewares);
    },
    configurePreviewServer(server) {
      configure(server.middlewares);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [localContentPlugin(), offlineShellPlugin()],
  server: {
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
});
