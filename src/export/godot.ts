import type { NineSlice } from "../domain/nineSlice.js";

/** A value safe inside a Godot string literal: quotes and backslashes escaped, no line breaks. */
const str = (v: string) => v.replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"');

/**
 * Godot 4 StyleBoxTexture for a 9-slice UI image: use it as a Panel / Button theme style,
 * or copy the margins to a NinePatchRect's patch_margin_*.
 */
export function styleBoxTextureTres(path: string, slice: NineSlice): string {
  return `[gd_resource type="StyleBoxTexture" load_steps=2 format=3]

[ext_resource type="Texture2D" path="${str(path)}" id="1"]

[resource]
texture = ExtResource("1")
texture_margin_left = ${slice.left.toFixed(1)}
texture_margin_top = ${slice.top.toFixed(1)}
texture_margin_right = ${slice.right.toFixed(1)}
texture_margin_bottom = ${slice.bottom.toFixed(1)}
`;
}

export interface FramesAnimation {
  name: string;
  /** res:// paths of the frame PNGs, in order */
  paths: string[];
  fps: number;
  loop: boolean;
}

/**
 * Godot 4 SpriteFrames resource with one or more named animations whose frames are separate PNG files.
 * `paths` are res:// paths, so the bundle must be unzipped at the matching place in the Godot project.
 */
export function spriteFramesMultiTres(anims: FramesAnimation[]): string {
  const all = anims.flatMap((a) => a.paths);
  const ids = new Map(all.map((p, i) => [p, i + 1]));
  const ext = [...ids.entries()].map(([p, id]) => `[ext_resource type="Texture2D" path="${str(p)}" id="${id}"]`).join("\n");
  const body = anims
    .map((a) => {
      const frames = a.paths.map((p) => `{\n"duration": 1.0,\n"texture": ExtResource("${ids.get(p)}")\n}`).join(", ");
      return `{\n"frames": [${frames}],\n"loop": ${a.loop},\n"name": &"${str(a.name)}",\n"speed": ${a.fps.toFixed(1)}\n}`;
    })
    .join(", ");
  return `[gd_resource type="SpriteFrames" load_steps=${ids.size + 1} format=3]

${ext}

[resource]
animations = [${body}]
`;
}

/** SpriteFrames with a single animation (default name "default", looping). */
export function spriteFramesTres(paths: string[], opts: { name?: string; fps?: number; loop?: boolean } = {}): string {
  return spriteFramesMultiTres([{ name: opts.name ?? "default", paths, fps: opts.fps ?? 8, loop: opts.loop ?? true }]);
}

/**
 * Godot 4 TileSet with one atlas source: `count` tiles of `tileSize` px laid out left to right,
 * `columns` per row, in the texture at `path`. Drop it on a TileMapLayer and paint.
 */
export function tileSetTres(path: string, o: { tileSize: number; count: number; columns: number }): string {
  const tiles = Array.from({ length: o.count }, (_, i) => `${i % o.columns}:${Math.floor(i / o.columns)}/0 = 0`).join("\n");
  return `[gd_resource type="TileSet" load_steps=3 format=3]

[ext_resource type="Texture2D" path="${str(path)}" id="1"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]
texture = ExtResource("1")
texture_region_size = Vector2i(${o.tileSize}, ${o.tileSize})
${tiles}

[resource]
tile_size = Vector2i(${o.tileSize}, ${o.tileSize})
sources/0 = SubResource("TileSetAtlasSource_1")
`;
}
