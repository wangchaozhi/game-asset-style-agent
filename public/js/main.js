// Entry point: load config, wire up every panel, open the last project.
import { api, toast } from "./lib.js";
import { state } from "./state.js";
import { bindProjects, loadProjects } from "./projects.js";
import { bindRefs } from "./refs.js";
import { bindStyleGuide } from "./styleGuide.js";
import { bindAssets } from "./assets.js";
import { bindViewer } from "./viewer.js";
import { bindRun, resumeJob } from "./run.js";

async function init() {
  state.config = await api("/api/config");
  bindRun();
  bindProjects(resumeJob);
  bindRefs();
  bindStyleGuide();
  bindAssets();
  bindViewer();
  await loadProjects();
  resumeJob();
}

init().catch((e) => toast(e.message));
