// Editable prompt with direct regeneration (image model only, no Claude).
import { $, api, esc, toast } from "../lib.js";
import { state } from "../state.js";
import { attachJob } from "../run.js";
import { t } from "../i18n.js";

export const html = (a) => `<form class="prompt-form" data-regen="${a.id}">
      <div class="sizes-head"><b>Prompt</b><span class="muted">${t("prompt.hint")}</span></div>
      <textarea name="prompt" rows="5" spellcheck="false" aria-label="Prompt">${esc(a.prompt)}</textarea>
      <button class="btn ghost" type="submit" title="${t("prompt.submitTitle")}">${t("prompt.submit")}</button>
    </form>`;

export function bind(root) {
  root.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-regen]");
    if (!form) return;
    e.preventDefault();
    if (state.job) return toast(t("viewer.busy"));
    try {
      const { jobId } = await api(`/api/projects/${state.project.id}/assets/${form.dataset.regen}/regenerate`, {
        method: "POST",
        body: { prompt: new FormData(form).get("prompt"), provider: $("#providerSelect").value },
      });
      $("#viewer").close();
      $("#log").innerHTML = "";
      attachJob(jobId);
    } catch (err) {
      if (err.data?.jobId) attachJob(err.data.jobId);
      toast(err.message);
    }
  });
}
