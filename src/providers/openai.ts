import { type ImageProvider, failOnHttpError } from "./types.js";

/** OpenAI gpt-image family; the edits endpoint accepts multiple reference images. */
export const openai: ImageProvider = {
  id: "openai",
  label: "OpenAI gpt-image",
  available: () => !!process.env.OPENAI_API_KEY,
  async generate(req, signal) {
    const size = { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" }[req.aspect];
    const model = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const auth = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
    const background = req.transparent ? "transparent" : "opaque";
    let res: Response;
    if (req.references.length) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", req.prompt);
      form.set("size", size);
      form.set("n", "1");
      form.set("quality", process.env.OPENAI_IMAGE_QUALITY ?? "high");
      form.set("background", background);
      req.references.slice(0, 16).forEach((r, i) => {
        form.append("image[]", new Blob([new Uint8Array(r.data)], { type: r.mime }), `ref${i}.png`);
      });
      res = await fetch(`${base}/images/edits`, { method: "POST", headers: auth, body: form, signal });
    } else {
      res = await fetch(`${base}/images/generations`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: req.prompt, size, n: 1, background }),
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
