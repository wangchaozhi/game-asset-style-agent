import { fetchWithRetry } from "./retry.js";
import { type ImageProvider, failOnHttpError } from "./types.js";

/** Canvas sizes for SDXL-class models (≈1 MP); SD_SIZE scales them, e.g. 512 for SD 1.5. */
export function sdCanvasSize(aspect: "square" | "landscape" | "portrait", frames: number | undefined, base: number) {
  const round8 = (n: number) => Math.max(64, Math.round(n / 8) * 8);
  if (frames && frames > 1) {
    // One row of frames: keep each cell square-ish but cap the total width.
    const cell = round8(Math.min(base * 0.5, (base * 2) / frames));
    return { width: round8(Math.min(cell * frames, base * 2)), height: cell };
  }
  const r = { square: [1, 1], landscape: [1.1875, 0.8125], portrait: [0.8125, 1.1875] }[aspect];
  return { width: round8(base * r[0]), height: round8(base * r[1]) };
}

/**
 * AUTOMATIC1111 / Forge Stable Diffusion WebUI (started with --api).
 * Reference images steer style through a ControlNet IP-Adapter unit when SD_IPADAPTER_MODEL is set;
 * otherwise the style comes from the prompt alone.
 */
export const sdwebui: ImageProvider = {
  id: "sdwebui",
  label: "Stable Diffusion WebUI（本地）",
  available: () => !!process.env.SD_WEBUI_URL,
  async generate(req, signal) {
    const base = process.env.SD_WEBUI_URL!.replace(/\/+$/, "");
    const env = process.env;
    const { width, height } = sdCanvasSize(req.aspect, req.frames, Number(env.SD_SIZE ?? 1024));
    const prompt = req.transparent
      ? `${req.prompt}, isolated on a plain flat pure white background, no ground shadow`
      : req.prompt;
    const body: Record<string, unknown> = {
      prompt,
      negative_prompt: env.SD_NEGATIVE_PROMPT ?? "text, watermark, signature, logo, blurry, lowres, jpeg artifacts, frame, border",
      width,
      height,
      steps: Number(env.SD_STEPS ?? 28),
      cfg_scale: Number(env.SD_CFG ?? 6),
      sampler_name: env.SD_SAMPLER ?? "DPM++ 2M",
      batch_size: 1,
      n_iter: 1,
      send_images: true,
      save_images: false,
    };
    if (env.SD_CHECKPOINT) body.override_settings = { sd_model_checkpoint: env.SD_CHECKPOINT };
    const ipModel = env.SD_IPADAPTER_MODEL;
    if (ipModel && req.references.length) {
      body.alwayson_scripts = {
        controlnet: {
          args: [
            {
              enabled: true,
              image: req.references[0].data.toString("base64"),
              module: env.SD_IPADAPTER_MODULE ?? "ip-adapter_clip_sdxl",
              model: ipModel,
              weight: Number(env.SD_IPADAPTER_WEIGHT ?? 0.7),
              control_mode: "Balanced",
              pixel_perfect: true,
            },
          ],
        },
      };
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.SD_API_AUTH) headers.Authorization = `Basic ${Buffer.from(env.SD_API_AUTH).toString("base64")}`;
    const res = await fetchWithRetry(`${base}/sdapi/v1/txt2img`, { method: "POST", headers, body: JSON.stringify(body), signal }, { onRetry: req.onRetry });
    await failOnHttpError(res, "SD WebUI");
    const json = (await res.json()) as { images?: string[] };
    const b64 = json.images?.[0];
    if (!b64) throw new Error("SD WebUI returned no image");
    // Some builds prefix a data URL.
    return { data: Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64"), mime: "image/png" };
  },
};
