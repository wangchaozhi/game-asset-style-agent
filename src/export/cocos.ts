/** One atlas page as written for Phaser / PixiJS: TexturePacker "JSON Hash" frames. */
interface JsonPage {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>;
  meta: { image: string; size: { w: number; h: number } };
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);

/**
 * The same page as a cocos2d plist (format 3, TexturePacker's "cocos2d-x" output), which Cocos Creator
 * imports as a SpriteAtlas and cocos2d-x loads with SpriteFrameCache::addSpriteFramesWithFile.
 * Frames are untrimmed and unrotated, so offsets are zero and source size equals frame size.
 */
export function cocosPlist(page: JsonPage): string {
  const frames = Object.entries(page.frames)
    .map(([name, { frame: f }]) =>
      [
        `\t\t<key>${xml(name)}</key>`,
        "\t\t<dict>",
        "\t\t\t<key>aliases</key>",
        "\t\t\t<array/>",
        "\t\t\t<key>spriteOffset</key>",
        "\t\t\t<string>{0,0}</string>",
        "\t\t\t<key>spriteSize</key>",
        `\t\t\t<string>{${f.w},${f.h}}</string>`,
        "\t\t\t<key>spriteSourceSize</key>",
        `\t\t\t<string>{${f.w},${f.h}}</string>`,
        "\t\t\t<key>textureRect</key>",
        `\t\t\t<string>{{${f.x},${f.y}},{${f.w},${f.h}}}</string>`,
        "\t\t\t<key>textureRotated</key>",
        "\t\t\t<false/>",
        "\t\t</dict>",
      ].join("\n"),
    )
    .join("\n");
  const { image, size } = page.meta;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>frames</key>
\t<dict>
${frames}
\t</dict>
\t<key>metadata</key>
\t<dict>
\t\t<key>format</key>
\t\t<integer>3</integer>
\t\t<key>pixelFormat</key>
\t\t<string>RGBA8888</string>
\t\t<key>premultiplyAlpha</key>
\t\t<false/>
\t\t<key>realTextureFileName</key>
\t\t<string>${xml(image)}</string>
\t\t<key>size</key>
\t\t<string>{${size.w},${size.h}}</string>
\t\t<key>textureFileName</key>
\t\t<string>${xml(image)}</string>
\t</dict>
</dict>
</plist>
`;
}
