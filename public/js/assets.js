// Asset library grid and filters.
import { $ } from "./lib.js";
import { esc } from "./lib.js";
import { fileUrl, state } from "./state.js";

export function renderAssets(newId) {
  const all = state.project.assets;
  const shown = all.filter((a) => state.filter === "all" || a.status === state.filter).slice().reverse();
  $("#assetCount").textContent = all.length ? `${all.filter((a) => a.status === "approved").length}/${all.length}` : "";
  const label = { approved: "✓ 通过", rejected: "✗ 驳回", pending_review: "… 审核中" };
  const typeName = (t) => state.config.assetTypes[t] ?? t;
  $("#assets").innerHTML = shown.length
    ? shown
        .map(
          (a) => `<div class="card ${a.status} ${a.id === newId ? "new" : ""}" data-asset="${a.id}">
            <div class="checker"><img loading="lazy" src="${fileUrl(a.gif ?? a.file)}" alt="${esc(a.name)}" /></div>
            <div class="meta"><span class="name">${esc(a.name)}</span>
              <span class="sub"><span>${esc(typeName(a.assetType))}</span><span class="badge ${a.status}">${label[a.status]}${a.score ? ` ${a.score}/10` : ""}</span></span>
            </div></div>`,
        )
        .join("")
    : `<p class="empty">${all.length ? "没有符合筛选的素材" : "生成的素材会出现在这里"}</p>`;
}

export function upsertAsset(asset) {
  const list = state.project.assets;
  const i = list.findIndex((a) => a.id === asset.id);
  if (i >= 0) list[i] = asset;
  else list.push(asset);
  renderAssets(i >= 0 ? undefined : asset.id);
}


export function bindAssets() {
  $("#filters").addEventListener("click", (e) => {
    const f = e.target.dataset?.filter;
    if (!f) return;
    state.filter = f;
    document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("on", b.dataset.filter === f));
    renderAssets();
  });
}
