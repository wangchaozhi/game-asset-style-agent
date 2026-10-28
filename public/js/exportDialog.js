// Export dialog: every option of the ZIP and atlas exports in one place, remembered per browser.
import { $, esc } from "./lib.js";
import { state } from "./state.js";
import { t } from "./i18n.js";

const KEY = "gaa.export";
const DEFAULTS = { kind: "zip", scope: "approved", tag: "", names: "original", sizes: false, unity: false, godot: "assets", tile: "32", max: "256", size: "2048", cocos: false };

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

/** Options that describe how to export; scope and tag (what to export) stay as chosen when a preset is applied. */
const FORMAT_KEYS = ["kind", "names", "sizes", "unity", "godot", "tile", "max", "size", "cocos"];

/** Built-in presets for common engines, by i18n key. */
export const BUILTIN_PRESETS = {
  "export.preset.unity": { kind: "zip", names: "ascii", unity: true },
  "export.preset.godot": { kind: "zip", names: "ascii", unity: false },
  "export.preset.phaser": { kind: "atlas", names: "original", cocos: false },
  "export.preset.cocos": { kind: "atlas", names: "ascii", cocos: true },
};

const PRESETS_KEY = "gaa.exportPresets";

/** The format part of a set of options (what a preset stores). */
export const formatOf = (o) => Object.fromEntries(FORMAT_KEYS.map((k) => [k, o[k]]));

/** Options after applying a preset: its format over the defaults, keeping the current scope and tag. */
export const applyPreset = (o, preset) => ({ ...o, ...formatOf({ ...DEFAULTS, ...preset }) });

/** The preset (id) whose format equals the current options, or "" when none does. */
export function matchingPreset(o, presets) {
  const now = JSON.stringify(formatOf(o));
  return Object.keys(presets).find((id) => JSON.stringify(formatOf({ ...DEFAULTS, ...presets[id] })) === now) ?? "";
}

function loadPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function savePresets(p) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(p));
  } catch {}
}

/** Every preset by id: built-ins as "builtin:<key>", the user's as "user:<name>". */
const allPresets = () => ({
  ...Object.fromEntries(Object.entries(BUILTIN_PRESETS).map(([k, v]) => [`builtin:${k}`, v])),
  ...Object.fromEntries(Object.entries(loadPresets()).map(([k, v]) => [`user:${k}`, v])),
});

function renderPresets(o) {
  const user = Object.keys(loadPresets());
  const sel = $("#exportPreset");
  sel.innerHTML = `<option value="">${esc(t("export.preset.custom"))}</option>
    <optgroup label="${esc(t("export.preset.builtin"))}">${Object.keys(BUILTIN_PRESETS).map((k) => `<option value="builtin:${k}">${esc(t(k))}</option>`).join("")}</optgroup>
    ${user.length ? `<optgroup label="${esc(t("export.preset.mine"))}">${user.map((n) => `<option value="user:${esc(n)}">${esc(n)}</option>`).join("")}</optgroup>` : ""}`;
  sel.value = matchingPreset(o, allPresets());
  $("#exportPresetDelete").hidden = !sel.value.startsWith("user:");
}

/** The export URL for the chosen options; defaults are left out so URLs stay short. */
export function exportUrl(projectId, o) {
  const q = new URLSearchParams();
  if (o.scope === "all") q.set("status", "all");
  if (o.tag) q.set("tag", o.tag);
  if (o.names === "ascii") q.set("names", "ascii");
  if (o.kind === "atlas") {
    if (o.max !== DEFAULTS.max) q.set("max", o.max);
    if (o.size !== DEFAULTS.size) q.set("size", o.size);
    if (o.cocos) q.set("cocos", "1");
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
    names: fd.get("names") ?? "original",
    sizes: fd.has("sizes"),
    unity: fd.has("unity"),
    godot: String(fd.get("godot") ?? "").trim(),
    tile: fd.get("tile"),
    max: fd.get("max"),
    size: fd.get("size"),
    cocos: fd.has("cocos"),
  };
}

/** Same rule as the server's ASCII file names (export/bundle.ts): what isn't [A-Za-z0-9_.-] after cleanup gets "type_number". */
export const renamedAscii = (name) => !/^[A-Za-z0-9_.-]+$/.test(String(name).replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "asset");

const hasTag = (a, tag) => !tag || (a.tags ?? []).some((x) => x.toLowerCase() === tag.toLowerCase());

/** The assets an export with options `o` includes (before any format-specific exclusions). */
export const exportPicks = (assets, o) => assets.filter((a) => (o.scope === "all" || a.status === "approved") && hasTag(a, o.tag));

/**
 * What to know before downloading: assets left out, files that won't be what one might expect.
 * Returns [{ key, n }] for the export.note.* messages, only the ones that apply.
 */
export function exportNotes(assets, o) {
  const picks = exportPicks(assets, o);
  const count = (pred) => picks.filter(pred).length;
  const notes = [
    ["unapproved", o.scope === "all" ? 0 : assets.filter((a) => a.status !== "approved" && hasTag(a, o.tag)).length],
    ["noBackground", o.kind === "atlas" ? count((a) => a.assetType === "background") : 0],
    ["unsliced", count((a) => a.assetType === "sprite_sheet" && !a.frames?.length)],
    ["noNine", count((a) => a.assetType === "ui" && !a.nineSlice)],
    ["cocosNine", o.kind === "atlas" && o.cocos ? count((a) => a.nineSlice) : 0],
    ["renamed", o.names === "ascii" ? count((a) => renamedAscii(a.name)) : 0],
  ];
  return notes.filter(([, n]) => n > 0).map(([key, n]) => ({ key, n }));
}

/** Show only the options of the chosen format and refresh the download link. */
function update() {
  const form = $("#exportForm");
  const o = read(form);
  for (const el of form.querySelectorAll("[data-kind]")) el.hidden = el.dataset.kind !== o.kind;
  const link = $("#exportGo");
  link.href = exportUrl(state.project.id, o);
  const n = exportPicks(state.project.assets, o).length;
  $("#exportCount").textContent = n ? t("export.count", { n }) : t("export.none");
  $("#exportNotes").innerHTML = (n ? exportNotes(state.project.assets, o) : []).map(({ key, n: k }) => `<li>${esc(t(`export.note.${key}`, { n: k }))}</li>`).join("");
  link.classList.toggle("disabled", !n);
  link.setAttribute("aria-disabled", String(!n));
  save(o);
  renderPresets(o);
}

/** Put a set of options into the form. */
function fill(form, o) {
  form.elements.kind.value = o.kind;
  form.elements.scope.value = o.scope;
  form.elements.names.value = o.names;
  form.elements.sizes.checked = o.sizes;
  form.elements.unity.checked = o.unity;
  form.elements.godot.value = o.godot;
  form.elements.tile.value = o.tile;
  form.elements.max.value = o.max;
  form.elements.size.value = o.size;
  form.elements.cocos.checked = o.cocos;
}

function open() {
  const o = load();
  const form = $("#exportForm");
  const tags = [...new Set(state.project.assets.flatMap((a) => a.tags ?? []))].sort();
  form.elements.tag.innerHTML = `<option value="">${t("filter.allTags")}</option>${tags.map((tag) => `<option value="${esc(tag)}">#${esc(tag)}</option>`).join("")}`;
  fill(form, o);
  form.elements.tag.value = tags.includes(o.tag) ? o.tag : "";
  update();
  $("#exportDialog").showModal();
}

export function bindExportDialog() {
  $("#exportMore").addEventListener("click", open);
  $("#exportPreset").addEventListener("change", (e) => {
    const preset = allPresets()[e.target.value];
    if (!preset) return;
    const form = $("#exportForm");
    fill(form, applyPreset(read(form), preset));
    update();
  });
  $("#exportPresetSave").addEventListener("click", () => {
    const name = prompt(t("export.preset.namePrompt"), "")?.trim().slice(0, 40);
    if (!name) return;
    savePresets({ ...loadPresets(), [name]: formatOf(read($("#exportForm"))) });
    update();
  });
  $("#exportPresetDelete").addEventListener("click", () => {
    const id = $("#exportPreset").value;
    if (!id.startsWith("user:")) return;
    const presets = loadPresets();
    delete presets[id.slice(5)];
    savePresets(presets);
    update();
  });
  $("#exportForm").addEventListener("input", update);
  $("#exportForm").addEventListener("change", update);
  // Enter in a text field would submit the form; there is nothing to submit.
  $("#exportForm").addEventListener("submit", (e) => e.preventDefault());
  $("#exportGo").addEventListener("click", (e) => {
    if (e.currentTarget.classList.contains("disabled")) e.preventDefault();
    else setTimeout(() => $("#exportDialog").close(), 0);
  });
}
