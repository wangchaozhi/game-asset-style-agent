import type { Asset } from "../store/types.js";

/** Most review notes kept per asset; the oldest drop off first. */
export const NOTE_LOG_MAX = 20;

/**
 * Append a review note to the asset's history (with who wrote it, the verdict and score it came with).
 * Empty notes and an exact repeat of the last entry are skipped.
 */
export function recordNote(asset: Asset, by: "agent" | "user", notes: string, at = new Date().toISOString()) {
  const text = notes.trim();
  if (!text || asset.noteLog?.at(-1)?.notes === text) return;
  const entry = { at, by, notes: text, status: asset.status, ...(asset.score !== undefined && by === "agent" ? { score: asset.score } : {}) };
  asset.noteLog = [...(asset.noteLog ?? []), entry].slice(-NOTE_LOG_MAX);
}
