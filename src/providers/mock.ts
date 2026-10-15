import crypto from "node:crypto";
import sharp from "sharp";
import type { ImageProvider } from "./types.js";

/** Deterministic placeholder art, for running the whole pipeline without an image API. */
export const mock: ImageProvider = {
  id: "mock",
  label: "Mock（离线占位图）",
  available: () => true,
  async generate(req) {
    const frames = Math.max(1, req.frames ?? 1);
    const [cw, h] = { square: [512, 512], landscape: [768, 512], portrait: [512, 768] }[req.aspect];
    const w = frames > 1 ? frames * 192 : cw;
    const hash = crypto.createHash("sha1").update(req.prompt).digest();
    // Pull hex colours mentioned in the prompt (the agent puts the palette there) so the mock still "follows" the style.
    const hexes = [...req.prompt.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
    const pick = (i: number) => hexes[(hash[i] ?? 0) % Math.max(hexes.length, 1)] ?? `hsl(${(hash[i] ?? 0) * 1.4},60%,55%)`;
    const [c1, c2, c3] = [pick(0), pick(1), pick(2)];
    const sides = 3 + (hash[4] % 5);
    const cellW = w / frames;
    const shape = (cx: number, cy: number, r: number, rot: number) => {
      const pts = Array.from({ length: sides }, (_, i) => {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2 + rot;
        return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
      }).join(" ");
      return `<polygon points="${pts}" fill="${c1}" stroke="${c2}" stroke-width="${Math.max(4, r / 10)}" stroke-linejoin="round"/>
        <circle cx="${cx}" cy="${cy}" r="${r * 0.35}" fill="${c2}"/>`;
    };
    const body =
      frames > 1
        ? Array.from({ length: frames }, (_, i) =>
            shape(cellW * (i + 0.5), h / 2 - Math.sin((i / frames) * Math.PI * 2) * 30, cellW * 0.32, (i / frames) * Math.PI),
          ).join("")
        : shape(w / 2, h / 2, Math.min(w, h) * (0.22 + (hash[3] % 10) / 100), 0);
    const label = req.prompt.replace(/[<>&"]/g, "").slice(0, 38);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      ${req.transparent ? `<rect width="100%" height="100%" fill="#ffffff"/>` : `<rect width="100%" height="100%" fill="${c3}" opacity="0.35"/>`}
      ${body}
      ${frames > 1 ? "" : `<text x="50%" y="${h - 24}" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#222">${label}</text>`}
    </svg>`;
    const delay = Number(process.env.MOCK_DELAY_MS ?? 400);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    return { data: await sharp(Buffer.from(svg)).png().toBuffer(), mime: "image/png" };
  },
};
