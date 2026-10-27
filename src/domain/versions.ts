import type { Asset } from "../store/types.js";

/**
 * Old versions that are safe to clear away: assets with a newer version (through parentId, any depth)
 * that is approved. If the newer versions are all pending or rejected, the old one may still be the
 * best, so it stays. Colour variants are siblings, not versions, and never count.
 */
export function replaceableVersions(assets: Asset[]): string[] {
  const children = new Map<string, Asset[]>();
  for (const a of assets) if (a.parentId) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const memo = new Map<string, boolean>();
  const hasApprovedDescendant = (id: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    memo.set(id, false); // guards against a (corrupt) cycle
    const found = (children.get(id) ?? []).some((c) => c.status === "approved" || hasApprovedDescendant(c.id));
    memo.set(id, found);
    return found;
  };
  return assets.filter((a) => hasApprovedDescendant(a.id)).map((a) => a.id);
}
