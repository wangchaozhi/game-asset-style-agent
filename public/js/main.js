// Entry point: load config, wire up every panel, open the last project.
import { api, toast } from "./lib.js";
import { state } from "./state.js";
import { bindProjects, loadProjects } from "./projects.js";
import { bindRefs } from "./refs.js";
import { bindStyleGuide } from "./styleGuide.js";
import { bindAssets } from "./assets.js";
import { bindViewer, openViewer } from "./viewer/index.js";
import { bindBatch } from "./batch.js";
import { bindRun, resumeJob } from "./run.js";
import { bindExportDialog } from "./exportDialog.js";
import { bindConsistency } from "./consistency.js";
import { bindImport } from "./importAssets.js";
import { bindScene } from "./scene.js";

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
