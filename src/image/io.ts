import sharp from "sharp";
import type { ImageInput } from "../providers/types.js";

/** Downscale for sending to Claude (keeps request size small) or as a reference to the image model. */
export async function shrink(img: ImageInput, max = 768): Promise<ImageInput> {
  const out = await sharp(img.data)
    .resize(max, max, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85 })
    .toBuffer();
  return { data: out, mime: "image/jpeg" };
}

/** Pixel size of an encoded image. */
export async function imageSize(data: Buffer): Promise<{ width: number; height: number }> {
  const { width = 0, height = 0 } = await sharp(data).metadata();
  return { width, height };
}

/** Normalise uploads to PNG (keeps alpha) so every provider accepts them. */
export async function toPng(data: Buffer): Promise<Buffer> {
  return sharp(data).rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
}
