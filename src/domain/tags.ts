/** At most this many tags per asset, each at most MAX_TAG_LENGTH characters. */
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 20;

/** Trim, drop empties and duplicates (case-insensitive), cap count and length. */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export const hasTag = (tags: string[] | undefined, tag: string) => !!tags?.some((t) => t.toLowerCase() === tag.toLowerCase());
