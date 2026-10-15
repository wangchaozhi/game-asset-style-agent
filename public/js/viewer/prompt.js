// Editable prompt with direct regeneration (image model only, no Claude).
import { $, api, esc, toast } from "../lib.js";
import { state } from "../state.js";
import { attachJob } from "../run.js";

export const html = (a) => `<form class="prompt-form" data-regen="${a.id}">
      <div class="sizes-head"><b>Prompt</b><span class="muted">可直接修改后重生成</span></div>
      <textarea name="prompt" rows="5" spellcheck="false" aria-label="Prompt">${esc(a.prompt)}</textarea>
      <button class="btn ghost" type="submit" title="用编辑后的 prompt 直接调用图像模型生成新版本，不经过 Claude">直接重生成（不经过 Agent）</button>
    </form>`;

export function bind(root) {
  root.addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-regen]");
    if (!form) return;
    e.preventDefault();
    if (state.job) return toast("已有任务在运行，请稍候");
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
