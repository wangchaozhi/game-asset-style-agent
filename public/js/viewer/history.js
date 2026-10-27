// Version timeline: every version of this asset (and its colour variants) with review notes, oldest first.
import { esc } from "../lib.js";
import { state, thumbUrl } from "../state.js";
import { t } from "../i18n.js";

/** How a version was made, from its provider (history.origin.*), else "generated (provider)". */
const ORIGINS = new Set(["postprocess", "import", "mock"]);

/** The root of the asset's version chain, then everything descending from it (new versions and variants). */
export function lineage(a, assets = state.project.assets) {
  const byId = new Map(assets.map((x) => [x.id, x]));
  let root = a;
  for (let up = byId.get(root.parentId ?? root.variantOf); up; up = byId.get(root.parentId ?? root.variantOf)) root = up;
  const out = [];
  const visit = (x) => {
    out.push(x);
    for (const c of assets) if (c.parentId === x.id || c.variantOf === x.id) visit(c);
  };
  visit(root);
  return out.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

/** The version `delta` steps away from `a` in its timeline (oldest first), or null at either end. */
export function stepVersion(a, delta, assets = state.project.assets) {
  const list = lineage(a, assets);
  return list[list.findIndex((x) => x.id === a.id) + delta] ?? null;
}

export function html(a) {
  const items = lineage(a);
  if (items.length < 2) return "";
  return `<details class="version-log">
    <summary><b>${t("history.title")}</b> <span class="muted">${t("history.count", { n: items.length })}</span></summary>
    <ol>${items
      .map((x) => {
        const kind = x.variantOf ? t("mark.variantTitle") : ORIGINS.has(x.provider) ? t(`history.origin.${x.provider}`) : t("history.generated", { provider: x.provider });
        // Post-processed versions and variants carry a log of what was done, not a review.
        const who = x.provider === "postprocess" ? t("history.processed") : x.reviewer === "user" ? t("viewer.myNotes") : x.reviewer === "agent" ? t("viewer.agentNotes") : "";
        return `<li class="${x.id === a.id ? "here" : ""}">
          <button type="button" class="version-thumb checker" data-open="${x.id}" title="${t("history.open")}"><img src="${thumbUrl(x.gif ?? x.file, 160)}" alt="" /></button>
          <div><b>${esc(x.name)}</b>${x.id === a.id ? ` <span class="muted">${t("history.current")}</span>` : ""}
            <span class="muted">${new Date(x.createdAt).toLocaleString()} · ${esc(kind)} · ${t(`filter.${x.status}`)}${x.score && x.reviewer === "agent" ? ` ${x.score}/10` : ""}</span>
            ${x.notes ? `<span>${who ? `${who}: ` : ""}${esc(x.notes)}</span>` : ""}</div>
        </li>`;
      })
      .join("")}</ol>
  </details>`;
}
