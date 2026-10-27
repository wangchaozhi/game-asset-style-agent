// Export dialog: every option of the ZIP and atlas exports in one place, remembered per browser.
import { $, esc } from "./lib.js";
import { state } from "./state.js";

const KEY = "gaa.export";
const DEFAULTS = { kind: "zip", scope: "approved", tag: "", sizes: false, unity: false, godot: "assets", tile: "32", max: "256", size: "2048" };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(opts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(opts));
  } catch {}
}

/** The export URL for the chosen options; defaults are left out so URLs stay short. */
export function exportUrl(projectId, o) {
  const q = new URLSearchParams();
  if (o.scope === "all") q.set("status", "all");
  if (o.tag) q.set("tag", o.tag);
  if (o.kind === "atlas") {
    if (o.max !== DEFAULTS.max) q.set("max", o.max);
    if (o.size !== DEFAULTS.size) q.set("size", o.size);
  } else {
    if (o.sizes) q.set("sizes", "1");
    if (o.unity) q.set("unity", "1");
    if (o.godot && o.godot !== DEFAULTS.godot) q.set("godot", o.godot);
    if (o.tile !== DEFAULTS.tile) q.set("tile", o.tile);
  }
  const qs = q.toString();
  return `/api/projects/${projectId}/${o.kind === "atlas" ? "export-atlas.zip" : "export.zip"}${qs ? `?${qs}` : ""}`;
}

function read(form) {
  const fd = new FormData(form);
  return {
    kind: fd.get("kind"),
    scope: fd.get("scope"),
    tag: fd.get("tag") ?? "",
    sizes: fd.has("sizes"),
    unity: fd.has("unity"),
    godot: String(fd.get("godot") ?? "").trim(),
    tile: fd.get("tile"),
    max: fd.get("max"),
    size: fd.get("size"),
  };
}

/** Show only the options of the chosen format and refresh the download link. */
function update() {
  const form = $("#exportForm");
  const o = read(form);
  for (const el of form.querySelectorAll("[data-kind]")) el.hidden = el.dataset.kind !== o.kind;
  const link = $("#exportGo");
  link.href = exportUrl(state.project.id, o);
  const n = state.project.assets.filter(
    (a) => (o.scope === "all" || a.status === "approved") && (!o.tag || (a.tags ?? []).some((t) => t.toLowerCase() === o.tag.toLowerCase())),
  ).length;
  $("#exportCount").textContent = n ? `${n} 个素材` : "没有符合条件的素材";
  link.classList.toggle("disabled", !n);
  link.setAttribute("aria-disabled", String(!n));
  save(o);
}

function open() {
  const o = load();
  const form = $("#exportForm");
  const tags = [...new Set(state.project.assets.flatMap((a) => a.tags ?? []))].sort();
  form.elements.tag.innerHTML = `<option value="">全部标签</option>${tags.map((t) => `<option value="${esc(t)}">#${esc(t)}</option>`).join("")}`;
  form.elements.kind.value = o.kind;
  form.elements.scope.value = o.scope;
  form.elements.tag.value = tags.includes(o.tag) ? o.tag : "";
  form.elements.sizes.checked = o.sizes;
  form.elements.unity.checked = o.unity;
  form.elements.godot.value = o.godot;
  form.elements.tile.value = o.tile;
  form.elements.max.value = o.max;
  form.elements.size.value = o.size;
  update();
  $("#exportDialog").showModal();
}

export function bindExportDialog() {
  $("#exportMore").addEventListener("click", open);
  $("#exportForm").addEventListener("input", update);
  $("#exportForm").addEventListener("change", update);
  // Enter in a text field would submit the form; there is nothing to submit.
  $("#exportForm").addEventListener("submit", (e) => e.preventDefault());
  $("#exportGo").addEventListener("click", (e) => {
    if (e.currentTarget.classList.contains("disabled")) e.preventDefault();
    else setTimeout(() => $("#exportDialog").close(), 0);
  });
}
