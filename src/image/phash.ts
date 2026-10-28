import sharp from "sharp";

/**
 * Difference hash (dHash): the image shrunk to 9×8 greys, one bit per horizontal neighbour pair
 * (left brighter than right). Near-identical pictures — a redraw that barely changed, the same icon
 * re-imported, a recolour of nothing — land within a few bits of each other. Transparency is laid
 * over mid grey first, so the empty background of cut-out sprites hashes the same everywhere.
 * Returned as 16 hex digits.
 */
export async function dHash(data: Buffer): Promise<string> {
  const px = await sharp(data)
    .flatten({ background: "#808080" })
    .grayscale()
    .resize(9, 8, { fit: "fill", kernel: sharp.kernel.cubic })
    .raw()
    .toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, "0");
}

/** Number of differing bits between two dHashes (0 = same picture as far as the hash can tell, 64 = opposite). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x; x &= x - 1n) n++;
  return n;
}
