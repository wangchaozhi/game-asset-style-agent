import { fetchWithRetry } from "./retry.js";
import { type ImageProvider, failOnHttpError } from "./types.js";

/** Google Gemini image models; multi-image reference via inline_data. */
export const gemini: ImageProvider = {
  id: "gemini",
  label: "Google Gemini Image",
  available: () => !!(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY),
  async generate(req, signal) {
    const model = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY!;
    const aspectRatio = { square: "1:1", landscape: "3:2", portrait: "2:3" }[req.aspect];
    // Gemini can't output alpha: ask for a flat white backdrop that the cut-out step removes.
    const text = req.transparent
      ? `${req.prompt}\n\nIsolate the subject on a perfectly flat, plain pure-white (#FFFFFF) background with no shadow on the ground, so it can be cut out cleanly.`
      : req.prompt;
    const parts = [
      ...req.references.slice(0, 14).map((r) => ({ inline_data: { mime_type: r.mime, data: r.data.toString("base64") } })),
      { text },
    ];
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } },
        }),
        signal,
      },
      { onRetry: req.onRetry },
    );
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
