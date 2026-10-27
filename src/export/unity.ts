import crypto from "node:crypto";
import type { NineSlice } from "../domain/nineSlice.js";

/**
 * Stable 32-hex Unity GUID from a seed, so re-exporting the same asset keeps its GUID and
 * scene / prefab references in the Unity project don't break.
 */
export const unityGuid = (seed: string) => crypto.createHash("md5").update(`game-asset-agent:${seed}`).digest("hex");

/** Stable 64-bit id Unity uses for a sprite inside a texture; 52 bits so it stays a safe JS integer. */
const internalId = (seed: string) => Number(BigInt(`0x${unityGuid(seed).slice(0, 13)}`));

export interface UnitySpriteMeta {
  /** GUID seed, e.g. "<projectId>/<assetId>/<file in the bundle>" */
  seed: string;
  /** point filtering, no compression: for pixel art */
  pixel: boolean;
  /** repeat wrap (tiles) instead of clamp */
  repeat?: boolean;
  /** 9-slice margins in image pixels */
  nineSlice?: NineSlice | null;
  /** sprite sheet: one row of equal frames; the texture is imported as Multiple sprites */
  frames?: { count: number; width: number; height: number; name: string };
  /** pivot at the bottom centre (characters stand on their feet) instead of the centre */
  bottomPivot?: boolean;
}

/**
 * TextureImporter .meta for one PNG, imported as a Sprite (2D and UI). Unity fills any setting
 * left out with its defaults on import, so only the ones that matter here are written.
 */
export function spriteMeta(o: UnitySpriteMeta): string {
  const b = o.nineSlice;
  // Unity's border is (x: left, y: bottom, z: right, w: top).
  const border = b ? `{x: ${b.left}, y: ${b.bottom}, z: ${b.right}, w: ${b.top}}` : "{x: 0, y: 0, z: 0, w: 0}";
  const alignment = o.bottomPivot ? 7 : 0;
  const pivot = o.bottomPivot ? "{x: 0.5, y: 0}" : "{x: 0.5, y: 0.5}";
  const sprites = o.frames
    ? Array.from({ length: o.frames.count }, (_, i) => {
        const name = `${o.frames!.name}_${i}`;
        return `    - serializedVersion: 2
      name: ${name}
      rect:
        serializedVersion: 2
        x: ${i * o.frames!.width}
        y: 0
        width: ${o.frames!.width}
        height: ${o.frames!.height}
      alignment: ${alignment}
      pivot: ${pivot}
      border: {x: 0, y: 0, z: 0, w: 0}
      spriteID: ${unityGuid(`${o.seed}#${i}`)}
      internalID: ${internalId(`${o.seed}#${i}`)}`;
      })
    : [];
  const nameTable = o.frames
    ? `\n    nameFileIdTable:\n${sprites.map((_, i) => `      ${o.frames!.name}_${i}: ${internalId(`${o.seed}#${i}`)}`).join("\n")}`
    : "";
  return `fileFormatVersion: 2
guid: ${unityGuid(o.seed)}
TextureImporter:
  serializedVersion: 12
  mipmaps:
    enableMipMap: 0
  textureSettings:
    serializedVersion: 2
    filterMode: ${o.pixel ? 0 : 1}
    wrapU: ${o.repeat ? 0 : 1}
    wrapV: ${o.repeat ? 0 : 1}
  textureType: 8
  textureShape: 1
  alphaIsTransparency: 1
  spriteMode: ${o.frames ? 2 : 1}
  spritePixelsToUnits: 100
  alignment: ${alignment}
  spritePivot: ${pivot}
  spriteBorder: ${border}
  spriteMeshType: ${b || o.pixel ? 0 : 1}
  textureCompression: ${o.pixel ? 0 : 1}
  spriteSheet:
    serializedVersion: 2
    sprites:${sprites.length ? `\n${sprites.join("\n")}` : " []"}${nameTable}
  userData:
  assetBundleName:
  assetBundleVariant:
`;
}
