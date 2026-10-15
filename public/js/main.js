// Entry point: load config, wire up every panel, open the last project.
import { api, toast } from "./lib.js";
import { state } from "./state.js";
import { bindProjects, loadProjects } from "./projects.js";
import { bindRefs } from "./refs.js";
import { bindStyleGuide } from "./styleGuide.js";
import { bindAssets } from "./assets.js";
import { bindViewer, openViewer } from "./viewer.js";
import { bindBatch } from "./batch.js";
import { bindRun, resumeJob } from "./run.js";

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
  bindBatch();
  await loadProjects();
  resumeJob();
}

init().catch((e) => toast(e.message));
