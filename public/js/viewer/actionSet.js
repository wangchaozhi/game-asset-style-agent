// Action set: ask the agent for idle / walk / attack … sprite sheets of this character.
import { state } from "../state.js";
import { runActionSet } from "../run.js";
import { onSubmit } from "./common.js";

const TYPES = new Set(["character", "enemy"]);
/** Checked by default: the core loop most games need first. */
const DEFAULT_ON = new Set(["idle", "walk", "attack", "hurt"]);

export function html(a) {
  if (!TYPES.has(a.assetType)) return "";
  const presets = Object.entries(state.config.actionPresets ?? {});
  return `<form class="action-set" data-action-set="${a.id}">
    <div class="sizes-head"><b>动作套装</b><span class="muted">以此图为一致性参考，每个动作一张精灵表</span></div>
    <div class="action-list">${presets
      .map(([k, p]) => `<label title="${p.frames} 帧 · ${p.fps} FPS"><input type="checkbox" name="action" value="${k}" ${DEFAULT_ON.has(k) ? "checked" : ""} /> ${p.label}</label>`)
      .join("")}</div>
    <button class="btn ghost" type="submit">生成动作套装</button>
  </form>`;
}

export function bind(root) {
  onSubmit(root, "form[data-action-set]", async (form, fd) => {
    const actions = fd.getAll("action");
    if (!actions.length) throw new Error("请至少选择一个动作");
    if (state.job) throw new Error("已有任务在运行，请稍候");
    if (!state.project.refs.length && !state.project.styleGuide) throw new Error("请先上传至少一张风格参考图，或新建项目时选择风格预设");
    document.querySelector("#viewer").close();
    await runActionSet(form.dataset.actionSet, actions);
  });
}
