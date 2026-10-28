import zlib from "node:zlib";
import { msg } from "../i18n.js";

export interface UnzipLimits {
  /** max number of entries */
  maxEntries?: number;
  /** max total uncompressed bytes */
  maxTotalBytes?: number;
}

export interface UnzippedEntry {
  name: string;
  data: Buffer;
}

/**
 * Read a ZIP archive (stored or deflated entries, no zip64, no encryption) via its central directory.
 * Enforces entry-count and total-size limits while inflating so a zip bomb can't exhaust memory,
 * and verifies each entry's CRC. Directory entries are skipped.
 */
export function readZip(buf: Buffer, limits: UnzipLimits = {}): UnzippedEntry[] {
  const maxEntries = limits.maxEntries ?? 10_000;
  let budget = limits.maxTotalBytes ?? 1024 * 1024 * 1024;
  // The end-of-central-directory record is in the last 22 + 65535 bytes.
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buf.lastIndexOf(sig, Math.max(0, buf.length - 22));
  if (eocd < 0 || eocd < buf.length - 22 - 0xffff) throw new Error(msg("err.zipInvalid"));
  const count = buf.readUInt16LE(eocd + 10);
  if (count > maxEntries) throw new Error(msg("err.zipTooMany", { n: count }));
  let p = buf.readUInt32LE(eocd + 16);
  const out: UnzippedEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error(msg("err.zipDir"));
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString(flags & 0x800 ? "utf8" : "latin1");
    p += 46 + nlen + xlen + clen;
    if (flags & 0x1) throw new Error(msg("err.zipEncrypted"));
    if (name.endsWith("/")) continue;
    if (usize > budget) throw new Error(msg("err.zipTooBig"));
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error(msg("err.zipEntry"));
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(1, budget) });
    else throw new Error(msg("err.zipMethod", { n: method }));
    if (data.length !== usize) throw new Error(msg("err.zipSize", { name }));
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error(msg("err.zipCrc", { name }));
    budget -= data.length;
    out.push({ name, data });
  }
  return out;
}
