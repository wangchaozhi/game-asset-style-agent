import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(5).toString("hex")}`;

export const projectsDir = () => path.join(config.dataDir, "projects");

export const projectDir = (id: string) => {
  if (!/^prj_[0-9a-f]+$/.test(id)) throw new Error("invalid project id");
  return path.join(projectsDir(), id);
};

/** Write via a temp file + rename so readers never see a half-written file. */
export async function writeAtomic(file: string, data: string | Buffer) {
  await fs.writeFile(file + ".tmp", data);
  await fs.rename(file + ".tmp", file);
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Run async tasks one at a time per key (e.g. per project) so read-modify-write cycles don't interleave. */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    tails.set(key, next.catch(() => undefined));
    return next;
  };
}
