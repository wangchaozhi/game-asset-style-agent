// Action set: ask the agent for idle / walk / attack … sprite sheets of this character.
import { state } from "../state.js";
import { runActionSet } from "../run.js";
import { onSubmit } from "./common.js";
import { has, t } from "../i18n.js";
import { esc } from "../lib.js";

const TYPES = new Set(["character", "enemy"]);
/** Checked by default: the core loop most games need first. */
const DEFAULT_ON = new Set(["idle", "walk", "attack", "hurt"]);

export function html(a) {
  if (!TYPES.has(a.assetType)) return "";
  const presets = Object.entries(state.config.actionPresets ?? {});
  return `<form class="action-set" data-action-set="${a.id}">
    <div class="sizes-head"><b>${t("action.title")}</b><span class="muted">${t("action.hint")}</span></div>
    <div class="action-list">${presets
      .map(([k, p]) => `<label title="${t("action.meta", { frames: p.frames, fps: p.fps })}"><input type="checkbox" name="action" value="${k}" ${DEFAULT_ON.has(k) ? "checked" : ""} /> ${esc(has(`action.${k}`) ? t(`action.${k}`) : p.label)}</label>`)
      .join("")}</div>
    <button class="btn ghost" type="submit">${t("action.submit")}</button>
  </form>`;
}

export function bind(root) {
  onSubmit(root, "form[data-action-set]", async (form, fd) => {
    const actions = fd.getAll("action");
    if (!actions.length) throw new Error(t("action.none"));
    if (state.job) throw new Error(t("viewer.busy"));
    if (!state.project.refs.length && !state.project.styleGuide) throw new Error(t("action.noStyle"));
    document.querySelector("#viewer").close();
    await runActionSet(form.dataset.actionSet, actions);
  });
}
