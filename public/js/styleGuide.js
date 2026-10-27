// Style guide panel: read-only view and the inline editor.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";
import { has, t } from "./i18n.js";

/** Free-text style guide fields, labelled by sg.<field>. */
const STYLE_FIELDS = ["rendering", "line_and_edges", "lighting_and_shading", "perspective", "proportions", "texture_and_detail", "mood"];

const emptyStyle = () => ({
  summary: "",
  palette: [{ hex: "#222222", role: t("sg.roleOutline") }, { hex: "#ffffff", role: t("sg.roleHighlight") }, { hex: "#e2562b", role: t("sg.roleMain") }],
  rendering: "", line_and_edges: "", lighting_and_shading: "", perspective: "", proportions: "",
  texture_and_detail: "", mood: "", avoid: [], prompt_prefix: "",
});

export function paletteRow(c) {
  return `<div class="pal-row">
    <input type="color" value="${esc(c.hex)}" data-pal="pick" aria-label="${t("sg.pick")}" />
    <input type="text" value="${esc(c.hex)}" data-pal="hex" maxlength="7" aria-label="${t("sg.hex")}" />
    <input type="text" value="${esc(c.role)}" data-pal="role" placeholder="${t("sg.role")}" aria-label="${t("sg.roleLabel")}" />
    <button type="button" class="btn link" data-pal="del" title="${t("batch.delete")}" aria-label="${t("sg.delColor")}">×</button>
  </div>`;
}

export function renderStyleEditor() {
  const sg = state.project.styleGuide ?? emptyStyle();
  const box = $("#styleGuide");
  box.className = "style-guide editing";
  box.innerHTML = `<form id="styleForm">
    <label>${t("sg.summary")}<textarea name="summary" rows="2">${esc(sg.summary)}</textarea></label>
    <div class="field-label">${t("sg.palette")}</div>
    <div id="palRows">${sg.palette.map(paletteRow).join("")}</div>
    <button type="button" class="btn link" id="addColor">${t("sg.addColor")}</button>
    ${STYLE_FIELDS.map((k) => `<label>${t(`sg.${k}`)}<textarea name="${k}" rows="2">${esc(sg[k])}</textarea></label>`).join("")}
    <label>${t("sg.avoidEdit")}<textarea name="avoid" rows="2">${esc((sg.avoid ?? []).join("\n"))}</textarea></label>
    <label>${t("sg.prefixEdit")}<textarea name="prompt_prefix" rows="4">${esc(sg.prompt_prefix)}</textarea></label>
    <div class="form-actions"><button class="btn primary" type="submit">${t("sg.save")}</button><button class="btn ghost" type="button" id="cancelStyle">${t("sg.cancel")}</button></div>
  </form>`;
}

export async function saveStyle(form) {
  const fd = new FormData(form);
  const palette = [...form.querySelectorAll(".pal-row")].map((r) => ({
    hex: r.querySelector('[data-pal="hex"]').value.trim(),
    role: r.querySelector('[data-pal="role"]').value.trim(),
  }));
  const body = { palette, avoid: String(fd.get("avoid")).split("\n").map((s) => s.trim()).filter(Boolean) };
  for (const k of ["summary", "prompt_prefix", ...STYLE_FIELDS]) body[k] = String(fd.get(k)).trim();
  try {
    state.project = await api(`/api/projects/${state.project.id}/style-guide`, { method: "PUT", body });
    renderStyle();
    toast(t("sg.saved"));
  } catch (e) {
    toast(e.message);
  }
}

/** The project conventions box: filled from the project, collapsed state notes whether any are set. */
function renderConventions() {
  const text = state.project.conventions ?? "";
  $("#conventions").value = text;
  $("#conventionsState").textContent = text ? t("sg.conventionsSet", { n: text.length }) : t("nine.unset");
}

export function renderStyle() {
  renderConventions();
  const sg = state.project.styleGuide;
  $("#editStyle").textContent = t(sg ? "style.edit" : "style.fill");
  const box = $("#styleGuide");
  $("#resetStyle").hidden = !sg;
  if (!sg) {
    box.className = "style-guide empty";
    box.textContent = t("style.empty");
    return;
  }
  box.className = "style-guide";
  box.innerHTML = `
    <p class="summary">${esc(sg.summary)}</p>
    <div class="palette">${sg.palette
      .map((c) => `<div class="swatch" title="${esc(c.role)}"><i style="background:${esc(c.hex)}"></i>${esc(c.hex)}</div>`)
      .join("")}</div>
    <dl>${STYLE_FIELDS.map((k) => `<dt>${t(`sg.${k}`)}</dt><dd>${esc(sg[k])}</dd>`).join("")}
      ${sg.avoid?.length ? `<dt>${t("sg.avoid")}</dt><dd>${esc(sg.avoid.join(t("drift.sep")))}</dd>` : ""}</dl>`;
}


export function bindStyleGuide() {
  bindStyleHistory();
  bindConventions();
  $("#editStyle").addEventListener("click", renderStyleEditor);
  const sgBox = $("#styleGuide");
  sgBox.addEventListener("submit", (e) => {
    e.preventDefault();
    saveStyle(e.target);
  });
  sgBox.addEventListener("click", (e) => {
    if (e.target.id === "cancelStyle") renderStyle();
    else if (e.target.id === "addColor") $("#palRows").insertAdjacentHTML("beforeend", paletteRow({ hex: "#888888", role: "" }));
    else if (e.target.dataset.pal === "del") e.target.closest(".pal-row").remove();
  });
  sgBox.addEventListener("input", (e) => {
    const row = e.target.closest(".pal-row");
    if (!row) return;
    if (e.target.dataset.pal === "pick") row.querySelector('[data-pal="hex"]').value = e.target.value;
    if (e.target.dataset.pal === "hex" && /^#[0-9a-fA-F]{6}$/.test(e.target.value)) row.querySelector('[data-pal="pick"]').value = e.target.value;
  });
  $("#resetStyle").addEventListener("click", async () => {
    if (!confirm(t("sg.confirmReset"))) return;
    state.project = await api(`/api/projects/${state.project.id}`, { method: "PATCH", body: { resetStyle: true } });
    renderStyle();
  });

}

// ---------------- history ----------------

/** Where a style guide version came from (sg.source.*), and a field's label (sg.*). */
const source = (s) => (has(`sg.source.${s}`) ? t(`sg.source.${s}`) : s);
const fieldName = (k) => (has(`sg.${k}`) ? t(`sg.${k}`) : k);

/** The versions last shown in the history dialog, for the compare view. */
let history = [];

/** One field's value as HTML: palettes as swatches, lists as items, text as text. */
function fieldValue(k, v) {
  if (k === "palette") {
    return `<span class="cmp-palette">${(v ?? []).map((c) => `<span><i style="background:${/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "transparent"}"></i>${esc(c.hex)} ${esc(c.role)}</span>`).join("")}</span>`;
  }
  if (Array.isArray(v)) return v.length ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="muted">${t("sg.empty")}</span>`;
  return v ? esc(v) : `<span class="muted">${t("sg.empty")}</span>`;
}

/** Field-by-field table of what differs between a past version and the current guide. */
function compareHtml(v) {
  const cur = state.project.styleGuide;
  if (!cur) return `<p class="muted">${t("sg.none")}</p>`;
  return `<table class="cmp-table"><thead><tr><th scope="col">${t("sg.field")}</th><th scope="col">${t("sg.thisVersion")}</th><th scope="col">${t("usage.currentCol")}</th></tr></thead><tbody>${v.changed
    .map((k) => `<tr><th scope="row">${esc(fieldName(k))}</th><td class="old">${fieldValue(k, v.styleGuide[k])}</td><td class="new">${fieldValue(k, cur[k])}</td></tr>`)
    .join("")}</tbody></table>`;
}

export async function openStyleHistory() {
  const dlg = $("#historyDialog");
  const body = $("#historyBody");
  body.innerHTML = `<p class="muted">${t("common.loading")}</p>`;
  dlg.showModal();
  try {
    const list = await api(`/api/projects/${state.project.id}/style-history`);
    history = list;
    body.innerHTML = list.length
      ? `<ol class="history">${list
          .map((v) => {
            const same = !v.changed.length;
            return `<li class="${same ? "current" : ""}">
              <div class="history-head">
                <span><b>${esc(source(v.source))}</b> <span class="muted">${v.source === "import" ? "" : new Date(v.at).toLocaleString()}</span></span>
                ${same ? `<span class="muted">${t("sg.inUse")}</span>` : `<span class="history-actions"><button class="btn ghost small" data-compare-style="${v.index}" aria-expanded="false">${t("sg.compare")}</button><button class="btn ghost small" data-restore-style="${v.index}">${t("sg.restore")}</button></span>`}
              </div>
              <p class="history-summary">${esc(v.styleGuide.summary)}</p>
              <div class="history-palette">${v.styleGuide.palette.map((c) => `<i title="${esc(c.hex)} ${esc(c.role)}" style="background:${esc(c.hex)}"></i>`).join("")}</div>
              ${same ? "" : `<p class="muted history-diff">${t("sg.differs", { fields: v.changed.map((k) => esc(fieldName(k))).join(t("tile.and")) })}</p><div class="style-compare" data-compare-body="${v.index}" hidden></div>`}
            </li>`;
          })
          .join("")}</ol>`
      : `<p class="muted">${t("sg.noHistory")}</p>`;
  } catch (e) {
    body.innerHTML = `<p class="bad">${esc(e.message)}</p>`;
  }
}

export function bindConventions() {
  $("#saveConventions").addEventListener("click", async () => {
    try {
      state.project = await api(`/api/projects/${state.project.id}`, { method: "PATCH", body: { conventions: $("#conventions").value } });
      renderConventions();
      toast(t(state.project.conventions ? "sg.conventionsSaved" : "sg.conventionsCleared"));
    } catch (err) {
      toast(err.message);
    }
  });
}

export function bindStyleHistory() {
  $("#styleHistory").addEventListener("click", openStyleHistory);
  $("#historyBody").addEventListener("click", async (e) => {
    const cmp = e.target.closest("[data-compare-style]");
    if (cmp) {
      const box = $(`#historyBody [data-compare-body="${cmp.dataset.compareStyle}"]`);
      const v = history.find((x) => String(x.index) === cmp.dataset.compareStyle);
      if (!box || !v) return;
      if (box.hidden) box.innerHTML = compareHtml(v);
      box.hidden = !box.hidden;
      cmp.setAttribute("aria-expanded", String(!box.hidden));
      cmp.textContent = t(box.hidden ? "sg.compare" : "sg.collapse");
      return;
    }
    const index = e.target.closest("[data-restore-style]")?.dataset.restoreStyle;
    if (index === undefined) return;
    try {
      state.project = await api(`/api/projects/${state.project.id}/style-history/${index}/restore`, { method: "POST" });
      renderStyle();
      toast(t("sg.restored"));
      openStyleHistory();
    } catch (err) {
      toast(err.message);
    }
  });
}
