import * as THREE from "three";

type SurfaceMaterial = THREE.MeshBasicMaterial | THREE.MeshStandardMaterial | THREE.ShaderMaterial;

const GEOMETRY_LIGHT = 0x20;
const GEOMETRY_MODULATE_MATERIAL_COLOR = 0x40;
const FILTER_NEAREST = 1;
const FILTER_LINEAR = 2;
const FILTER_MIP_NEAREST = 3;
const FILTER_MIP_LINEAR = 4;
const FILTER_LINEAR_MIP_NEAREST = 5;
const FILTER_LINEAR_MIP_LINEAR = 6;
const ADDRESS_MIRROR = 2;
const ADDRESS_CLAMP = 3;
const ADDRESS_BORDER = 4;

export interface RenderWareTrackTextureReference {
  name: string;
}

export interface RenderWareTrackMaterialEffect {
  type: string;
  sourceBlend?: number;
  destinationBlend?: number;
  texture?: RenderWareTrackTextureReference;
}

export interface RenderWareTrackMaterial {
  color: readonly [number, number, number, number];
  surfaceProperties: { specular: number };
  texture?: RenderWareTrackTextureReference;
  effects?: { effects: readonly RenderWareTrackMaterialEffect[] };
}

export interface RenderWareTrackSector {
  index: number;
  triangleCount: number;
  vertexCount: number;
  positions: Float32Array;
  normals?: Float32Array;
  colors?: Uint8Array;
  uvSets: readonly Float32Array[];
  indices: Uint32Array;
  triangleMaterialIndices: Uint16Array;
}

export interface RenderWareTrackWorld {
  header: { format: number };
  materials: readonly RenderWareTrackMaterial[];
  worldSectors: readonly RenderWareTrackSector[];
}

export interface RenderWareTrackTextureImage {
  width: number;
  height: number;
  alphaMode: "opaque" | "mask" | "blend";
  rgba: Uint8Array;
}

export interface RenderWareTrackTexture {
  name: string;
  filterFlags: number;
  mipmaps: readonly RenderWareTrackTextureImage[];
}

export interface RenderWareTrackTextureDictionary {
  textures: readonly RenderWareTrackTexture[];
}

export interface RenderWareTrackBuild {
  root: THREE.Group;
  textures: THREE.DataTexture[];
  textureMap: ReadonlyMap<string, THREE.DataTexture>;
  triangleCount: number;
  materialCount: number;
  textureCount: number;
  missingTextureNames: readonly string[];
}

function textureWrapping(address: number): THREE.Wrapping {
  if (address === ADDRESS_MIRROR) {
    return THREE.MirroredRepeatWrapping;
  }
  if (address === ADDRESS_CLAMP || address === ADDRESS_BORDER) {
    return THREE.ClampToEdgeWrapping;
  }
  return THREE.RepeatWrapping;
}

export function buildRenderWareTextures(
  dictionary: RenderWareTrackTextureDictionary | undefined,
): { byName: Map<string, THREE.DataTexture>; owned: THREE.DataTexture[] } {
  const byName = new Map<string, THREE.DataTexture>();
  const owned: THREE.DataTexture[] = [];
  for (const source of dictionary?.textures ?? []) {
    const base = source.mipmaps[0];
    if (!base) {
      continue;
    }
    const texture = new THREE.DataTexture(base.rgba, base.width, base.height, THREE.RGBAFormat);
    texture.name = source.name;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = true;
    const addressU = (source.filterFlags >>> 8) & 0x0f;
    const storedAddressV = (source.filterFlags >>> 12) & 0x0f;
    texture.wrapS = textureWrapping(addressU);
    texture.wrapT = textureWrapping(storedAddressV === 0 ? addressU : storedAddressV);

    const filterMode = source.filterFlags & 0xff;
    texture.magFilter = filterMode === FILTER_NEAREST
      || filterMode === FILTER_MIP_NEAREST
      ? THREE.NearestFilter
      : THREE.LinearFilter;
    texture.minFilter = {
      [FILTER_NEAREST]: THREE.NearestFilter,
      [FILTER_LINEAR]: THREE.LinearFilter,
      [FILTER_MIP_NEAREST]: THREE.NearestMipmapNearestFilter,
      [FILTER_MIP_LINEAR]: THREE.LinearMipmapNearestFilter,
      [FILTER_LINEAR_MIP_NEAREST]: THREE.NearestMipmapLinearFilter,
      [FILTER_LINEAR_MIP_LINEAR]: THREE.LinearMipmapLinearFilter,
    }[filterMode] ?? THREE.LinearFilter;

    const usesMipmaps = filterMode >= FILTER_MIP_NEAREST
      && filterMode <= FILTER_LINEAR_MIP_LINEAR;
    if (usesMipmaps && source.mipmaps.length > 1) {
      texture.mipmaps = source.mipmaps.map((mipmap) => ({
        data: mipmap.rgba,
        width: mipmap.width,
        height: mipmap.height,
      }));
      texture.generateMipmaps = false;
    } else {
      const autoMipmaps = (source.filterFlags & 0x1_0000) === 0;
      texture.generateMipmaps = usesMipmaps && autoMipmaps;
      if (usesMipmaps && !autoMipmaps) {
        texture.minFilter = texture.magFilter;
      }
    }
    texture.userData["alphaMode"] = base.alphaMode;
    texture.needsUpdate = true;
    byName.set(source.name.toLocaleLowerCase("en-US"), texture);
    owned.push(texture);
  }
  return { byName, owned };
}

function fallbackMaterial(): RenderWareTrackMaterial {
  return {
    color: [255, 255, 255, 255],
    surfaceProperties: { specular: 1 },
  };
}

export function buildRenderWareMaterials(
  sourceMaterials: readonly RenderWareTrackMaterial[],
  textures: ReadonlyMap<string, THREE.DataTexture>,
  hasVertexColors: boolean,
  geometryFormat: number,
): SurfaceMaterial[] {
  const materials = sourceMaterials.length > 0 ? sourceMaterials : [fallbackMaterial()];
  return materials.map((material) => {
    const map = material.texture
      ? textures.get(material.texture.name.toLocaleLowerCase("en-US"))
      : undefined;
    const modulatesColor = (geometryFormat & GEOMETRY_MODULATE_MATERIAL_COLOR) !== 0;
    const color = modulatesColor ? material.color : [255, 255, 255, material.color[3]] as const;
    const alphaMode = map?.userData["alphaMode"] as string | undefined;
    const hasTranslucency = alphaMode === "blend" || (color[3] > 0 && color[3] < 255);
    const hasAlphaMask = alphaMode === "mask";
    const dualEffect = material.effects?.effects.find((effect) => effect.type === "dual");
    const dualMap = dualEffect?.type === "dual" && dualEffect.texture
      ? textures.get(dualEffect.texture.name.toLocaleLowerCase("en-US"))
      : undefined;
    const common = {
      color: new THREE.Color(color[0] / 255, color[1] / 255, color[2] / 255),
      opacity: material.color[3] / 255,
      transparent: hasTranslucency,
      alphaTest: hasAlphaMask ? 0.5 : hasTranslucency ? 1 / 255 : 0,
      depthWrite: !hasTranslucency,
      map: map ?? null,
      vertexColors: hasVertexColors,
      side: THREE.FrontSide,
    };
    if (
      map
      && dualMap
      && dualEffect?.type === "dual"
      && dualEffect.sourceBlend === 5
      && dualEffect.destinationBlend === 6
      && (geometryFormat & GEOMETRY_LIGHT) === 0
    ) {
      return new THREE.ShaderMaterial({
        uniforms: {
          baseMap: { value: map },
          dualMap: { value: dualMap },
          materialColor: { value: common.color },
          materialOpacity: { value: common.opacity },
          alphaThreshold: { value: common.alphaTest },
        },
        defines: hasVertexColors ? { USE_VERTEX_COLOR: 1 } : {},
        vertexShader: `
          attribute vec2 uv1;
          varying vec2 vBaseUv;
          varying vec2 vDualUv;
          #ifdef USE_VERTEX_COLOR
            attribute vec3 color;
            varying vec3 vVertexColor;
          #endif
          void main() {
            vBaseUv = uv;
            vDualUv = uv1;
            #ifdef USE_VERTEX_COLOR
              vVertexColor = color;
            #endif
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D baseMap;
          uniform sampler2D dualMap;
          uniform vec3 materialColor;
          uniform float materialOpacity;
          uniform float alphaThreshold;
          varying vec2 vBaseUv;
          varying vec2 vDualUv;
          #ifdef USE_VERTEX_COLOR
            varying vec3 vVertexColor;
          #endif
          void main() {
            vec4 base = texture2D(baseMap, vBaseUv);
            vec4 dual = texture2D(dualMap, vDualUv);
            vec4 outputColor = mix(base, dual, dual.a);
            outputColor.rgb *= materialColor;
            outputColor.a *= materialOpacity;
            #ifdef USE_VERTEX_COLOR
              outputColor.rgb *= vVertexColor;
            #endif
            if (outputColor.a < alphaThreshold) discard;
            gl_FragColor = outputColor;
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        transparent: common.transparent,
        depthWrite: common.depthWrite,
        side: common.side,
      });
    }
    if ((geometryFormat & GEOMETRY_LIGHT) === 0) {
      return new THREE.MeshBasicMaterial(common);
    }
    return new THREE.MeshStandardMaterial({
      ...common,
      roughness: Math.max(0.15, 1 - material.surfaceProperties.specular * 0.25),
      metalness: 0,
    });
  });
}

export function groupSectorMaterials(
  geometry: THREE.BufferGeometry,
  sector: Pick<RenderWareTrackSector, "triangleCount" | "indices" | "triangleMaterialIndices">,
  materialCount: number,
): void {
  const groups = Array.from({ length: Math.max(materialCount, 1) }, () => [] as number[]);
  for (let triangle = 0; triangle < sector.triangleCount; triangle += 1) {
    const materialIndex = sector.triangleMaterialIndices[triangle] ?? 0;
    const group = groups[materialIndex];
    if (!group) {
      throw new Error(`Track triangle ${triangle} references missing material ${materialIndex}`);
    }
    group.push(
      sector.indices[triangle * 3]!,
      sector.indices[triangle * 3 + 1]!,
      sector.indices[triangle * 3 + 2]!,
    );
  }
  const flattened = new Uint32Array(sector.indices.length);
  let offset = 0;
  groups.forEach((indices, materialIndex) => {
    flattened.set(indices, offset);
    if (indices.length > 0) {
      geometry.addGroup(offset, indices.length, materialIndex);
    }
    offset += indices.length;
  });
  geometry.setIndex(new THREE.BufferAttribute(flattened, 1));
}

export function renderWareColorAttribute(
  colors: Uint8Array | undefined,
  vertexCount: number,
): Float32Array | undefined {
  if (!colors) {
    return undefined;
  }
  const normalized = new Float32Array(vertexCount * 3);
  for (let index = 0; index < vertexCount; index += 1) {
    normalized[index * 3] = colors[index * 4]! / 255;
    normalized[index * 3 + 1] = colors[index * 4 + 1]! / 255;
    normalized[index * 3 + 2] = colors[index * 4 + 2]! / 255;
  }
  return normalized;
}

export function buildRenderWareTrack(
  world: RenderWareTrackWorld,
  dictionary?: RenderWareTrackTextureDictionary,
): RenderWareTrackBuild {
  const root = new THREE.Group();
  root.name = "loaded-renderware-track";
  const textureSet = buildRenderWareTextures(dictionary);
  let triangleCount = 0;
  for (const sector of world.worldSectors) {
    if (sector.vertexCount === 0 || sector.triangleCount === 0) {
      continue;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(sector.positions, 3));
    if (sector.normals) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(sector.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    const colors = renderWareColorAttribute(sector.colors, sector.vertexCount);
    if (colors) {
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    if (sector.uvSets[0]) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(sector.uvSets[0], 2));
    }
    if (sector.uvSets[1]) {
      geometry.setAttribute("uv1", new THREE.BufferAttribute(sector.uvSets[1], 2));
    }
    const materials = buildRenderWareMaterials(
      world.materials,
      textureSet.byName,
      colors !== undefined,
      world.header.format,
    );
    groupSectorMaterials(geometry, sector, materials.length);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = `track-sector-${sector.index}`;
    mesh.receiveShadow = true;
    root.add(mesh);
    triangleCount += sector.triangleCount;
  }

  const referencedTextureNames = new Set(
    world.materials.flatMap((material) => {
      const names: string[] = [];
      if (material.texture) {
        names.push(material.texture.name.toLocaleLowerCase("en-US"));
      }
      for (const effect of material.effects?.effects ?? []) {
        if ("texture" in effect && effect.texture) {
          names.push(effect.texture.name.toLocaleLowerCase("en-US"));
        }
      }
      return names;
    }),
  );
  const missingTextureNames = [...referencedTextureNames].filter((name) => !textureSet.byName.has(name));
  return {
    root,
    textures: textureSet.owned,
    textureMap: textureSet.byName,
    triangleCount,
    materialCount: world.materials.length,
    textureCount: textureSet.owned.length,
    missingTextureNames,
  };
}
