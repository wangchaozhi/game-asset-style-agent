// Style guide panel: read-only view and the inline editor.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";

const STYLE_FIELDS = [
  ["rendering", "技法"],
  ["line_and_edges", "线条"],
  ["lighting_and_shading", "光影"],
  ["perspective", "视角"],
  ["proportions", "比例"],
  ["texture_and_detail", "细节"],
  ["mood", "氛围"],
];

const EMPTY_STYLE = {
  summary: "", palette: [{ hex: "#222222", role: "描边" }, { hex: "#ffffff", role: "高光" }, { hex: "#e2562b", role: "主色" }],
  rendering: "", line_and_edges: "", lighting_and_shading: "", perspective: "", proportions: "",
  texture_and_detail: "", mood: "", avoid: [], prompt_prefix: "",
};

export function paletteRow(c) {
  return `<div class="pal-row">
    <input type="color" value="${esc(c.hex)}" data-pal="pick" />
    <input type="text" value="${esc(c.hex)}" data-pal="hex" maxlength="7" />
    <input type="text" value="${esc(c.role)}" data-pal="role" placeholder="用途" />
    <button type="button" class="btn link" data-pal="del" title="删除">×</button>
  </div>`;
}

export function renderStyleEditor() {
  const sg = state.project.styleGuide ?? EMPTY_STYLE;
  const box = $("#styleGuide");
  box.className = "style-guide editing";
  box.innerHTML = `<form id="styleForm">
    <label>概述<textarea name="summary" rows="2">${esc(sg.summary)}</textarea></label>
    <div class="field-label">色板</div>
    <div id="palRows">${sg.palette.map(paletteRow).join("")}</div>
    <button type="button" class="btn link" id="addColor">+ 添加颜色</button>
    ${STYLE_FIELDS.map(([k, l]) => `<label>${l}<textarea name="${k}" rows="2">${esc(sg[k])}</textarea></label>`).join("")}
    <label>避免（每行一条）<textarea name="avoid" rows="2">${esc((sg.avoid ?? []).join("\n"))}</textarea></label>
    <label>Prompt 前缀（英文，生成时拼在每条 prompt 前）<textarea name="prompt_prefix" rows="4">${esc(sg.prompt_prefix)}</textarea></label>
    <div class="form-actions"><button class="btn primary" type="submit">保存</button><button class="btn ghost" type="button" id="cancelStyle">取消</button></div>
  </form>`;
}

export async function saveStyle(form) {
  const fd = new FormData(form);
  const palette = [...form.querySelectorAll(".pal-row")].map((r) => ({
    hex: r.querySelector('[data-pal="hex"]').value.trim(),
    role: r.querySelector('[data-pal="role"]').value.trim(),
  }));
  const body = { palette, avoid: String(fd.get("avoid")).split("\n").map((s) => s.trim()).filter(Boolean) };
  for (const k of ["summary", "prompt_prefix", ...STYLE_FIELDS.map(([k]) => k)]) body[k] = String(fd.get(k)).trim();
  try {
    state.project = await api(`/api/projects/${state.project.id}/style-guide`, { method: "PUT", body });
    renderStyle();
    toast("风格指南已保存，之后的生成都会使用它");
  } catch (e) {
    toast(e.message);
  }
}

export function renderStyle() {
  const sg = state.project.styleGuide;
  $("#editStyle").textContent = sg ? "编辑" : "手动填写";
  const box = $("#styleGuide");
  $("#resetStyle").hidden = !sg;
  if (!sg) {
    box.className = "style-guide empty";
    box.textContent = "还没有风格指南，第一次运行时 Agent 会根据参考图自动生成。";
    return;
  }
  box.className = "style-guide";
  box.innerHTML = `
    <p class="summary">${esc(sg.summary)}</p>
    <div class="palette">${sg.palette
      .map((c) => `<div class="swatch" title="${esc(c.role)}"><i style="background:${esc(c.hex)}"></i>${esc(c.hex)}</div>`)
      .join("")}</div>
    <dl>${STYLE_FIELDS.map(([k, l]) => `<dt>${l}</dt><dd>${esc(sg[k])}</dd>`).join("")}
      ${sg.avoid?.length ? `<dt>避免</dt><dd>${esc(sg.avoid.join("；"))}</dd>` : ""}</dl>`;
}


export function bindStyleGuide() {
  bindStyleHistory();
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
    if (!confirm("清空当前风格指南？下次运行时 Agent 会重新从参考图提炼。")) return;
    state.project = await api(`/api/projects/${state.project.id}`, { method: "PATCH", body: { resetStyle: true } });
    renderStyle();
  });

}

// ---------------- history ----------------

const SOURCE = { agent: "Agent 提炼", user: "手动编辑", restore: "恢复", import: "早期版本" };
const FIELD = Object.fromEntries([["summary", "概述"], ["palette", "色板"], ["avoid", "避免"], ["prompt_prefix", "Prompt 前缀"], ...STYLE_FIELDS]);

export async function openStyleHistory() {
  const dlg = $("#historyDialog");
  const body = $("#historyBody");
  body.innerHTML = `<p class="muted">加载中…</p>`;
  dlg.showModal();
  try {
    const list = await api(`/api/projects/${state.project.id}/style-history`);
    body.innerHTML = list.length
      ? `<ol class="history">${list
          .map((v) => {
            const same = !v.changed.length;
            return `<li class="${same ? "current" : ""}">
              <div class="history-head">
                <span><b>${esc(SOURCE[v.source] ?? v.source)}</b> <span class="muted">${v.source === "import" ? "" : new Date(v.at).toLocaleString()}</span></span>
                ${same ? `<span class="muted">当前使用中</span>` : `<button class="btn ghost small" data-restore-style="${v.index}">恢复此版本</button>`}
              </div>
              <p class="history-summary">${esc(v.styleGuide.summary)}</p>
              <div class="history-palette">${v.styleGuide.palette.map((c) => `<i title="${esc(c.hex)} ${esc(c.role)}" style="background:${esc(c.hex)}"></i>`).join("")}</div>
              ${same ? "" : `<p class="muted history-diff">与当前不同：${v.changed.map((k) => esc(FIELD[k] ?? k)).join("、")}</p>`}
            </li>`;
          })
          .join("")}</ol>`
      : `<p class="muted">还没有历史版本。Agent 提炼或手动保存风格指南后会记录在这里。</p>`;
  } catch (e) {
    body.innerHTML = `<p class="bad">${esc(e.message)}</p>`;
  }
}

export function bindStyleHistory() {
  $("#styleHistory").addEventListener("click", openStyleHistory);
  $("#historyBody").addEventListener("click", async (e) => {
    const index = e.target.closest("[data-restore-style]")?.dataset.restoreStyle;
    if (index === undefined) return;
    try {
      state.project = await api(`/api/projects/${state.project.id}/style-history/${index}/restore`, { method: "POST" });
      renderStyle();
      toast("已恢复该版本的风格指南");
      openStyleHistory();
    } catch (err) {
      toast(err.message);
    }
  });
}
