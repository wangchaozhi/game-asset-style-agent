// Similar assets: near-duplicates by perceptual hash, to spot accidental repeats across the library.
import { $, api, esc } from "../lib.js";
import { state, thumbUrl } from "../state.js";
import { t } from "../i18n.js";

/** Hash distance at or below which two pictures are probably the same asset. */
export const DUPLICATE_AT = 4;

/** Filled by load(); hidden until there is something to show. */
export const html = (a) => `<div class="similar" data-similar="${a.id}" hidden></div>`;

export async function load(a) {
  const box = $("#viewerMeta .similar");
  try {
    const { items } = await api(`/api/projects/${state.project.id}/assets/${a.id}/similar`);
    if (!box?.isConnected || state.viewing !== a.id) return;
    const byId = new Map(state.project.assets.map((x) => [x.id, x]));
    const shown = items.filter((i) => byId.has(i.id));
    if (!shown.length) return;
    const others = shown.filter((i) => !i.related);
    const dupes = others.filter((i) => i.distance <= DUPLICATE_AT).length;
    const note = dupes ? t("similar.dupes", { n: dupes }) : others.length ? t("similar.alike") : t("similar.onlyVersions");
    box.innerHTML = `<div class="sizes-head"><b>${t("similar.title")}</b><span class="muted${dupes ? " warn" : ""}">${esc(note)}</span></div>
      <div class="similar-list">${shown
        .map((i) => {
          const x = byId.get(i.id);
          const label = `${x.name} · ${t(i.related ? "similar.related" : "similar.distance", { n: i.distance })}`;
          return `<button type="button" class="similar-item checker ${i.related ? "related" : ""}" data-open="${i.id}" title="${esc(label)}" aria-label="${esc(label)}">
            <img src="${thumbUrl(x.gif ?? x.file, 160)}" alt="" /><span>${i.related ? "↺" : i.distance}</span></button>`;
        })
        .join("")}</div>`;
    box.hidden = false;
  } catch {
    // An optional hint: stay hidden on errors.
  }
}
