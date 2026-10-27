import type { NineSlice } from "../domain/nineSlice.js";

/**
 * Godot 4 StyleBoxTexture for a 9-slice UI image: use it as a Panel / Button theme style,
 * or copy the margins to a NinePatchRect's patch_margin_*.
 */
export function styleBoxTextureTres(path: string, slice: NineSlice): string {
  return `[gd_resource type="StyleBoxTexture" load_steps=2 format=3]

[ext_resource type="Texture2D" path="${path.replace(/"/g, '\\"')}" id="1"]

[resource]
texture = ExtResource("1")
texture_margin_left = ${slice.left.toFixed(1)}
texture_margin_top = ${slice.top.toFixed(1)}
texture_margin_right = ${slice.right.toFixed(1)}
texture_margin_bottom = ${slice.bottom.toFixed(1)}
`;
}

/**
 * Godot 4 SpriteFrames resource for one animation whose frames are separate PNG files.
 * `paths` are res:// paths, so the bundle must be unzipped at the matching place in the Godot project.
 */
export function spriteFramesTres(paths: string[], opts: { name?: string; fps?: number; loop?: boolean } = {}): string {
  const ext = paths
    .map((p, i) => `[ext_resource type="Texture2D" path="${p.replace(/"/g, '\\"')}" id="${i + 1}"]`)
    .join("\n");
  const frames = paths.map((_, i) => `{\n"duration": 1.0,\n"texture": ExtResource("${i + 1}")\n}`).join(", ");
  return `[gd_resource type="SpriteFrames" load_steps=${paths.length + 1} format=3]

${ext}

[resource]
animations = [{
"frames": [${frames}],
"loop": ${opts.loop ?? true},
"name": &"${(opts.name ?? "default").replace(/"/g, "")}",
"speed": ${(opts.fps ?? 8).toFixed(1)}
}]
`;
}

/**
 * Godot 4 TileSet with one atlas source: `count` tiles of `tileSize` px laid out left to right,
 * `columns` per row, in the texture at `path`. Drop it on a TileMapLayer and paint.
 */
export function tileSetTres(path: string, o: { tileSize: number; count: number; columns: number }): string {
  const tiles = Array.from({ length: o.count }, (_, i) => `${i % o.columns}:${Math.floor(i / o.columns)}/0 = 0`).join("\n");
  return `[gd_resource type="TileSet" load_steps=3 format=3]

[ext_resource type="Texture2D" path="${path.replace(/"/g, '\\"')}" id="1"]

[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]
texture = ExtResource("1")
texture_region_size = Vector2i(${o.tileSize}, ${o.tileSize})
${tiles}

[resource]
tile_size = Vector2i(${o.tileSize}, ${o.tileSize})
sources/0 = SubResource("TileSetAtlasSource_1")
`;
}
