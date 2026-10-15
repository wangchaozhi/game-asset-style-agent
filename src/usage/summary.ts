import { roundUsd } from "./pricing.js";
import { totalTokens } from "./record.js";
import { type RunUsage, type UsageSummary, addInto, emptyTokens } from "./types.js";

/** Totals across runs. A cost part stays null if any run had an unknown price for it. */
export function summarize(list: RunUsage[]): UsageSummary {
  const s: UsageSummary = {
    runs: list.length,
    claudeRequests: 0,
    tokens: emptyTokens(),
    images: { calls: 0, failed: 0 },
    cost: { claude: 0, images: 0, total: 0 },
  };
  for (const r of list) {
    s.claudeRequests += r.claude.requests;
    addInto(s.tokens, totalTokens(r));
    s.images.calls += r.images.calls;
    s.images.failed += r.images.failed;
    s.cost.claude = s.cost.claude === null || r.cost.claude === null ? null : s.cost.claude + r.cost.claude;
    s.cost.images = s.cost.images === null || r.cost.images === null ? null : s.cost.images + r.cost.images;
    s.cost.total += r.cost.total;
  }
  s.cost = {
    claude: s.cost.claude === null ? null : roundUsd(s.cost.claude),
    images: s.cost.images === null ? null : roundUsd(s.cost.images),
    total: roundUsd(s.cost.total),
  };
  return s;
}
