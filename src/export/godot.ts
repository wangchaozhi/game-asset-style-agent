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
