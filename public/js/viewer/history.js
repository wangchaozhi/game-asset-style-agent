// Version timeline: every version of this asset (and its colour variants) with review notes, oldest first.
import { esc } from "../lib.js";
import { state, thumbUrl } from "../state.js";

const STATUS = { approved: "已通过", rejected: "已驳回", pending_review: "待审核" };
/** How a version was made, from its provider. */
const ORIGIN = { postprocess: "后处理", import: "导入", mock: "生成（Mock）" };

/** The root of the asset's version chain, then everything descending from it (new versions and variants). */
function lineage(a) {
  const byId = new Map(state.project.assets.map((x) => [x.id, x]));
  let root = a;
  for (let up = byId.get(root.parentId ?? root.variantOf); up; up = byId.get(root.parentId ?? root.variantOf)) root = up;
  const out = [];
  const visit = (x) => {
    out.push(x);
    for (const c of state.project.assets) if (c.parentId === x.id || c.variantOf === x.id) visit(c);
  };
  visit(root);
  return out.sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

export function html(a) {
  const items = lineage(a);
  if (items.length < 2) return "";
  return `<details class="version-log">
    <summary><b>版本记录</b> <span class="muted">${items.length} 个版本</span></summary>
    <ol>${items
      .map((x) => {
        const kind = x.variantOf ? "换色变体" : ORIGIN[x.provider] ?? `生成（${x.provider}）`;
        // Post-processed versions and variants carry a log of what was done, not a review.
        const who = x.provider === "postprocess" ? "处理" : x.reviewer === "user" ? "我的意见" : x.reviewer === "agent" ? "Agent 审核" : "";
        return `<li class="${x.id === a.id ? "here" : ""}">
          <button type="button" class="version-thumb checker" data-open="${x.id}" title="打开这个版本"><img src="${thumbUrl(x.gif ?? x.file, 160)}" alt="" /></button>
          <div><b>${esc(x.name)}</b>${x.id === a.id ? ' <span class="muted">（当前）</span>' : ""}
            <span class="muted">${new Date(x.createdAt).toLocaleString()} · ${esc(kind)} · ${STATUS[x.status] ?? x.status}${x.score && x.reviewer === "agent" ? ` ${x.score}/10` : ""}</span>
            ${x.notes ? `<span>${who ? `${who}：` : ""}${esc(x.notes)}</span>` : ""}</div>
        </li>`;
      })
      .join("")}</ol>
  </details>`;
}
