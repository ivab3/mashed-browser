#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { parseDff } from "./renderware/dff.js";
import { parseBspWorld } from "./renderware/bsp.js";
import { inspectTextureDictionary, parsePiTextureDictionary } from "./renderware/txd.js";
import { analyzeTriangleWinding, basisDeterminant, MASHED_ASSET_CONVENTIONS } from "./renderware/conventions.js";

function hex(value: number): string {
  return `0x${value.toString(16).padStart(8, "0")}`;
}

function materialSummary(materials: ReturnType<typeof parseBspWorld>["materials"]): object {
  return {
    flags: [...new Set(materials.map((material) => hex(material.flags)))],
    surfaceProperties: [...new Set(materials.map((material) => JSON.stringify(material.surfaceProperties)))].map(
      (value) => JSON.parse(value) as object,
    ),
    textureSampling: [...new Set(materials.flatMap((material) => material.texture
      ? [hex(material.texture.filterAddressing)]
      : []))],
    extensionChunks: [...new Set(materials.flatMap((material) => material.extensionChunks.map((chunk) => hex(chunk.id))))],
    effects: materials.flatMap((material, materialIndex) => material.effects
      ? [{ materialIndex, ...material.effects }]
      : []),
  };
}

function usage(): string {
  return "Usage: pnpm assets:probe (--dff model.dff | --txd textures.txd | --bsp world.bsp)";
}

const arguments_ = process.argv.slice(2);
if (arguments_.length !== 2 || !["--dff", "--txd", "--bsp"].includes(arguments_[0]!)) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
} else {
  try {
    const path = resolve(arguments_[1]!);
    const input = readFileSync(path);
    if (arguments_[0] === "--bsp") {
      const world = parseBspWorld(input);
      const textureNames = new Set(world.materials.flatMap((material) => material.texture?.name ?? []));
      const winding = world.worldSectors.reduce(
        (total, sector) => {
          if (sector.normals) {
            const analysis = analyzeTriangleWinding(sector.positions, sector.normals, sector.indices);
            total.aligned += analysis.aligned;
            total.opposed += analysis.opposed;
            total.degenerate += analysis.degenerate;
          }
          return total;
        },
        { aligned: 0, opposed: 0, degenerate: 0 },
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            path,
            ...world.header,
            libraryId: `0x${world.header.libraryId.toString(16).padStart(8, "0")}`,
            format: `0x${world.header.format.toString(16).padStart(8, "0")}`,
            materials: world.materials.length,
            materialSemantics: materialSummary(world.materials),
            winding,
            textures: [...textureNames].sort((left, right) => left.localeCompare(right, "en")),
          },
          null,
          2,
        )}\n`,
      );
      process.exit(0);
    }
    if (arguments_[0] === "--txd") {
      const inspection = inspectTextureDictionary(input);
      if (inspection.kind === "native") {
        process.stdout.write(
          `${JSON.stringify(
            {
              path,
              ...inspection,
              libraryId: hex(inspection.libraryId),
              textures: inspection.textures.map((texture) => ({
                ...texture,
                platform: hex(texture.platform),
                ...(texture.rasterFormat === undefined ? {} : { rasterFormat: hex(texture.rasterFormat) }),
              })),
            },
            null,
            2,
          )}\n`,
        );
        process.exit(0);
      }
      const dictionary = parsePiTextureDictionary(input);
      process.stdout.write(
        `${JSON.stringify(
          {
            path,
            flags: dictionary.flags,
            textures: dictionary.textures.map((texture) => ({
              name: texture.name,
              maskName: texture.maskName,
              filterFlags: hex(texture.filterFlags),
              mipmaps: texture.mipmaps.map((mipmap) => ({
                width: mipmap.width,
                height: mipmap.height,
                depth: mipmap.depth,
                stride: mipmap.stride,
                pixelFormat: mipmap.pixelFormat,
                alphaMode: mipmap.alphaMode,
              })),
            })),
          },
          null,
          2,
        )}\n`,
      );
      process.exit(0);
    }
    const model = parseDff(input);
    const textureNames = new Set(
      model.geometries.flatMap((geometry) => geometry.materials.flatMap((material) => material.texture?.name ?? [])),
    );
    const materials = model.geometries.flatMap((geometry) => geometry.materials);
    const winding = model.geometries.reduce(
      (total, geometry) => {
        const morph = geometry.morphTargets[0];
        if (morph?.positions && morph.normals) {
          const analysis = analyzeTriangleWinding(morph.positions, morph.normals, geometry.indices);
          total.aligned += analysis.aligned;
          total.opposed += analysis.opposed;
          total.degenerate += analysis.degenerate;
        }
        return total;
      },
      { aligned: 0, opposed: 0, degenerate: 0 },
    );
    const frameDeterminants = model.frames.map((frame) => basisDeterminant(frame.right, frame.up, frame.at));
    process.stdout.write(
      `${JSON.stringify(
        {
          path,
          libraryId: `0x${model.libraryId.toString(16).padStart(8, "0")}`,
          frames: model.frames.length,
          geometries: model.geometries.length,
          atomics: model.atomics.length,
          vertices: model.geometries.reduce((sum, geometry) => sum + geometry.vertexCount, 0),
          triangles: model.geometries.reduce((sum, geometry) => sum + geometry.triangleCount, 0),
          geometryFormats: [...new Set(model.geometries.map((geometry) => hex(geometry.format)))],
          materialSemantics: materialSummary(materials),
          conventions: MASHED_ASSET_CONVENTIONS,
          winding,
          frameDeterminants: {
            minimum: Math.min(...frameDeterminants),
            maximum: Math.max(...frameDeterminants),
            negative: frameDeterminants.filter((value) => value < 0).length,
          },
          textures: [...textureNames].sort((left, right) => left.localeCompare(right, "en")),
        },
        null,
        2,
      )}\n`,
    );
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
