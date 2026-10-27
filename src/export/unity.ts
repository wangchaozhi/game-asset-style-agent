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

/** Unity reference to sprite `i` of a Multiple-mode texture exported with spriteMeta. */
const spriteRef = (seed: string, i: number) => `{fileID: ${internalId(`${seed}#${i}`)}, guid: ${unityGuid(seed)}, type: 3}`;

/**
 * Looping AnimationClip (.anim) that flips a SpriteRenderer's m_Sprite through the frames of a sheet
 * exported with spriteMeta(seed, frames). Add it to an Animator, or drag it onto a sprite in the scene.
 */
export function animationClip(o: { name: string; sheetSeed: string; count: number; fps: number }): string {
  const fps = Math.max(1, Math.round(o.fps));
  const keys = Array.from({ length: o.count }, (_, i) => `    - time: ${+(i / fps).toFixed(6)}\n      value: ${spriteRef(o.sheetSeed, i)}`).join("\n");
  const mapping = Array.from({ length: o.count }, (_, i) => `    - ${spriteRef(o.sheetSeed, i)}`).join("\n");
  return `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!74 &7400000
AnimationClip:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_Name: ${o.name.replace(/[\r\n:]/g, " ")}
  serializedVersion: 7
  m_Legacy: 0
  m_Compressed: 0
  m_UseHighQualityCurve: 1
  m_RotationCurves: []
  m_CompressedRotationCurves: []
  m_EulerCurves: []
  m_PositionCurves: []
  m_ScaleCurves: []
  m_FloatCurves: []
  m_PPtrCurves:
  - curve:
${keys}
    attribute: m_Sprite
    path: 
    classID: 212
    script: {fileID: 0}
  m_SampleRate: ${fps}
  m_WrapMode: 0
  m_Bounds:
    m_Center: {x: 0, y: 0, z: 0}
    m_Extent: {x: 0, y: 0, z: 0}
  m_ClipBindingConstant:
    genericBindings:
    - serializedVersion: 2
      path: 0
      attribute: 0
      script: {fileID: 0}
      typeID: 212
      customType: 23
      isPPtrCurve: 1
    pptrCurveMapping:
${mapping}
  m_AnimationClipSettings:
    serializedVersion: 2
    m_AdditiveReferencePoseClip: {fileID: 0}
    m_AdditiveReferencePoseTime: 0
    m_StartTime: 0
    m_StopTime: ${+(o.count / fps).toFixed(6)}
    m_OrientationOffsetY: 0
    m_Level: 0
    m_CycleOffset: 0
    m_HasAdditiveReferencePose: 0
    m_LoopTime: 1
    m_LoopBlend: 0
    m_LoopBlendOrientation: 0
    m_LoopBlendPositionY: 0
    m_LoopBlendPositionXZ: 0
    m_KeepOriginalOrientation: 0
    m_KeepOriginalPositionY: 1
    m_KeepOriginalPositionXZ: 0
    m_HeightFromFeet: 0
    m_Mirror: 0
  m_EditorCurves: []
  m_EulerEditorCurves: []
  m_HasGenericRootTransform: 0
  m_HasMotionFloatCurves: 0
  m_Events: []
`;
}

/** .meta for a native Unity asset such as an .anim (main object 7400000 = the AnimationClip). */
export const nativeMeta = (seed: string) => `fileFormatVersion: 2
guid: ${unityGuid(seed)}
NativeFormatImporter:
  externalObjects: {}
  mainObjectFileID: 7400000
  userData:
  assetBundleName:
  assetBundleVariant:
`;
