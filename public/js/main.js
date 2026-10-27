// Entry point: load config, wire up every panel, open the last project.
import { api, toast } from "./lib.js";
import { state } from "./state.js";
import { bindProjects, loadProjects } from "./projects.js";
import { bindRefs } from "./refs.js";
import { bindViewer, openViewer } from "./viewer/index.js";
import { bindBatch } from "./batch.js";
import { bindRun, resumeJob } from "./run.js";
import { bindExportDialog } from "./exportDialog.js";
import { bindConsistency } from "./consistency.js";
import { bindImport } from "./importAssets.js";
import { bindScene } from "./scene.js";
import { applyI18n, getLang, setLang } from "./i18n.js";
import { bindAssets, renderAssets } from "./assets.js";
import { bindStyleGuide, renderStyle } from "./styleGuide.js";

// Safety net: an API failure in any handler that doesn't catch it still reaches the user.
// "?" anywhere outside a text field shows the shortcut list.
document.addEventListener("keydown", (e) => {
  if (e.key !== "?" || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  const help = document.querySelector("#shortcutsDialog");
  if (help.open) return;
  e.preventDefault();
  help.showModal();
});

window.addEventListener("unhandledrejection", (e) => {
  const msg = e.reason?.message ?? String(e.reason ?? "");
  if (msg) toast(msg);
});

// Static text first, so an English page doesn't flash Chinese while the config loads.
applyI18n();
document.querySelector("#langToggle").addEventListener("click", () => setLang(getLang() === "zh" ? "en" : "zh"));
document.addEventListener("gaa:lang", () => {
  if (!state.project) return;
  renderStyle();
  renderAssets();
});

async function init() {
  state.config = await api("/api/config");
  if (state.config.auth) {
    const out = document.querySelector("#logout");
    out.hidden = false;
    out.addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      location.href = "/login.html";
    });
  }
  bindRun();
  bindProjects(resumeJob);
  bindRefs();
  bindStyleGuide();
  bindAssets({ onOpen: openViewer });
  bindViewer();
  bindBatch({ onOpen: openViewer });
  bindExportDialog();
  bindConsistency({ onOpen: openViewer });
  bindImport();
  bindScene();
  await loadProjects();
  resumeJob();
}

init().catch((e) => toast(e.message));
