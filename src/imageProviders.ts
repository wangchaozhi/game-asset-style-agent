import crypto from "node:crypto";
import sharp from "sharp";

export type Aspect = "square" | "landscape" | "portrait";

export interface ImageInput {
  data: Buffer;
  mime: string;
}

export interface GenerateRequest {
  prompt: string;
  references: ImageInput[];
  aspect: Aspect;
  transparent: boolean;
}

export interface ImageProvider {
  id: string;
  label: string;
  available: () => boolean;
  generate: (req: GenerateRequest, signal?: AbortSignal) => Promise<ImageInput>;
}

async function failOnHttpError(res: Response, who: string) {
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throw new Error(`${who} HTTP ${res.status}: ${body.slice(0, 500)}`);
}

// ---------- OpenAI (gpt-image family, edits endpoint accepts multiple reference images) ----------
const openai: ImageProvider = {
  id: "openai",
  label: "OpenAI gpt-image",
  available: () => !!process.env.OPENAI_API_KEY,
  async generate(req, signal) {
    const size = { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" }[req.aspect];
    const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", req.prompt);
    form.set("size", size);
    form.set("n", "1");
    form.set("quality", process.env.OPENAI_IMAGE_QUALITY ?? "high");
    form.set("background", req.transparent ? "transparent" : "opaque");
    req.references.slice(0, 16).forEach((r, i) => {
      form.append("image[]", new Blob([new Uint8Array(r.data)], { type: r.mime }), `ref${i}.png`);
    });
    const endpoint = req.references.length ? "images/edits" : "images/generations";
    let res: Response;
    if (req.references.length) {
      res = await fetch(`${base}/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
        signal,
      });
    } else {
      res = await fetch(`${base}/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: req.prompt,
          size,
          n: 1,
          background: req.transparent ? "transparent" : "opaque",
        }),
        signal,
      });
    }
    await failOnHttpError(res, "OpenAI");
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI returned no image");
    return { data: Buffer.from(b64, "base64"), mime: "image/png" };
  },
};

// ---------- Google Gemini image models (multi-image reference via inline_data) ----------
const gemini: ImageProvider = {
  id: "gemini",
  label: "Google Gemini Image",
  available: () => !!(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
  async generate(req, signal) {
    const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY!;
    const aspectRatio = { square: "1:1", landscape: "3:2", portrait: "2:3" }[req.aspect];
    const text = req.transparent
      ? `${req.prompt}\n\nIsolate the subject on a perfectly flat, plain pure-white (#FFFFFF) background with no shadow on the ground, so it can be cut out cleanly.`
      : req.prompt;
    const parts = [
      ...req.references.slice(0, 14).map((r) => ({ inline_data: { mime_type: r.mime, data: r.data.toString("base64") } })),
      { text },
    ];
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } },
      }),
      signal,
    });
    await failOnHttpError(res, "Gemini");
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string }; text?: string }[] } }[];
    };
    const outParts = json.candidates?.[0]?.content?.parts ?? [];
    const img = outParts.find((p) => p.inlineData)?.inlineData;
    if (!img) {
      const said = outParts.map((p) => p.text).filter(Boolean).join(" ");
      throw new Error(`Gemini returned no image${said ? `: ${said.slice(0, 300)}` : ""}`);
    }
    return { data: Buffer.from(img.data, "base64"), mime: img.mimeType };
  },
};

// ---------- Mock: deterministic placeholder art, for running the whole pipeline without an image API ----------
const mock: ImageProvider = {
  id: "mock",
  label: "Mock（离线占位图）",
  available: () => true,
  async generate(req) {
    const [w, h] = { square: [512, 512], landscape: [768, 512], portrait: [512, 768] }[req.aspect];
    const hash = crypto.createHash("sha1").update(req.prompt).digest();
    // Pull hex colours mentioned in the prompt (the agent puts the palette there) so the mock still "follows" the style.
    const hexes = [...req.prompt.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0]);
    const pick = (i: number) => hexes[(hash[i] ?? 0) % Math.max(hexes.length, 1)] ?? `hsl(${(hash[i] ?? 0) * 1.4},60%,55%)`;
    const [c1, c2, c3] = [pick(0), pick(1), pick(2)];
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * (0.22 + (hash[3] % 10) / 100);
    const sides = 3 + (hash[4] % 5);
    const pts = Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      return `${cx + Math.cos(a) * r},${cy + Math.sin(a) * r}`;
    }).join(" ");
    const label = req.prompt.replace(/[<>&"]/g, "").slice(0, 38);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      ${req.transparent ? "" : `<rect width="100%" height="100%" fill="${c3}" opacity="0.35"/>`}
      <polygon points="${pts}" fill="${c1}" stroke="${c2}" stroke-width="10" stroke-linejoin="round"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 0.35}" fill="${c2}"/>
      <text x="50%" y="${h - 24}" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#222">${label}</text>
    </svg>`;
    await new Promise((r) => setTimeout(r, 400));
    return { data: await sharp(Buffer.from(svg)).png().toBuffer(), mime: "image/png" };
  },
};

export const providers: ImageProvider[] = [openai, gemini, mock];

export function getProvider(id: string | undefined): ImageProvider {
  const chosen = providers.find((p) => p.id === id);
  if (chosen) {
    if (!chosen.available()) throw new Error(`图像通道 ${chosen.label} 未配置 API key`);
    return chosen;
  }
  return providers.find((p) => p.available())!;
}

/** Downscale for sending to Claude (keeps request size small) or as a reference to the image model. */
export async function shrink(img: ImageInput, max = 768): Promise<ImageInput> {
  const out = await sharp(img.data)
    .resize(max, max, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { data: out, mime: "image/jpeg" };
}

/** Normalise uploads to PNG (keeps alpha) so every provider accepts them. */
export async function toPng(data: Buffer): Promise<Buffer> {
  return sharp(data).rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
}
