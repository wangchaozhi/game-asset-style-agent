// Duplicate overview: near-identical assets grouped, with one click to trash the extras of a group.
import { $, api, esc } from "./lib.js";
import { state, thumbUrl } from "./state.js";
import { renderAssets } from "./assets.js";
import { apply } from "./batch.js";
import { t } from "./i18n.js";

let groups = [];

function render() {
  const body = $("#dupBody");
  const byId = new Map(state.project.assets.map((a) => [a.id, a]));
  // Members may have been trashed since the groups were measured.
  const live = groups.map((g) => g.filter((id) => byId.has(id))).filter((g) => g.length > 1);
  if (!live.length) {
    body.innerHTML = `<p class="muted">${t("dup.none")}</p>`;
    return;
  }
  const extras = live.reduce((n, g) => n + g.length - 1, 0);
  body.innerHTML = `<p class="muted">${esc(t("dup.summary", { groups: live.length, n: extras }))}</p>
    <ol class="dup-groups">${live
      .map(
        (g) => `<li>
          <div class="dup-items">${g
            .map((id, i) => {
              const a = byId.get(id);
              return `<button type="button" class="dup-item checker ${i === 0 ? "keep" : ""}" data-open-asset="${id}" title="${esc(a.name)}">
                <img loading="lazy" src="${thumbUrl(a.gif ?? a.file, 160)}" alt="${esc(a.name)}" />
                <span>${esc(i === 0 ? t("dup.keep") : t(`filter.${a.status}`))}</span></button>`;
            })
            .join("")}</div>
          <button type="button" class="btn ghost small" data-dup-trash="${g.slice(1).join(",")}">${esc(t("dup.trashRest", { n: g.length - 1 }))}</button>
        </li>`,
      )
      .join("")}</ol>
    <div class="export-go"><span></span><button type="button" class="btn ghost" id="dupShowAll">${esc(t("dup.showInLibrary"))}</button></div>`;
}

async function open() {
  $("#dupBody").innerHTML = `<p class="muted">${t("common.loading")}</p>`;
  $("#dupDialog").showModal();
  try {
    groups = (await api(`/api/projects/${state.project.id}/duplicates`)).groups;
    render();
  } catch (e) {
    $("#dupBody").innerHTML = `<p class="bad">${esc(e.message)}</p>`;
  }
}

/** Library filter: only assets that are in some duplicate group. */
export function showOnly(ids) {
  state.onlyIds = ids ? new Set(ids) : null;
  $("#onlyIdsClear").hidden = !ids;
  renderAssets();
}

export function bindDuplicates({ onOpen }) {
  $("#dupBtn").addEventListener("click", open);
  $("#onlyIdsClear").addEventListener("click", () => showOnly(null));
  // The filter belongs to the project it was made in.
  document.addEventListener("gaa:project-switch", () => state.onlyIds && showOnly(null));
  $("#dupBody").addEventListener("click", async (e) => {
    const openId = e.target.closest("[data-open-asset]")?.dataset.openAsset;
    if (openId) {
      $("#dupDialog").close();
      return onOpen(openId);
    }
    const rest = e.target.closest("[data-dup-trash]")?.dataset.dupTrash;
    if (rest) {
      await apply("delete", rest.split(","));
      return render();
    }
    if (e.target.closest("#dupShowAll")) {
      $("#dupDialog").close();
      showOnly(groups.flat());
    }
  });
}
