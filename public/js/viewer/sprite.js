// Sprite sheets: animation preview, frame strip, re-slicing and frame alignment.
import { $, api, esc } from "../lib.js";
import { fileUrl, state } from "../state.js";
import { onSubmit } from "./common.js";
import { t } from "../i18n.js";

export function html(a) {
  if (a.assetType !== "sprite_sheet") return "";
  const frameFiles = a.frames ?? [];
  return `<div class="sprite">
      ${
        frameFiles.length
          ? `<div class="checker sprite-gif"><img class="sprite-live" src="${fileUrl(frameFiles[0])}?t=${Date.now()}" alt="${t("sprite.preview")}" /></div>`
          : a.gif
            ? `<div class="checker sprite-gif"><img src="${fileUrl(a.gif)}?t=${Date.now()}" alt="${t("sprite.preview")}" /></div>`
            : ""
      }
      ${frameFiles.length ? `<div class="frame-strip">${frameFiles.map((f, i) => `<a class="checker" href="${fileUrl(f)}" download="${esc(a.name)}_${i}.png" title="${t("sprite.downloadFrame", { n: i + 1 })}"><img src="${fileUrl(f)}?t=${Date.now()}" alt="${t("sprite.frame", { n: i + 1 })}" /></a>`).join("")}</div>` : ""}
      <form class="slice-form" data-slice="${a.id}">
        <label>${t("import.frames")} <input name="frames" type="number" min="1" max="32" value="${frameFiles.length || 4}" /></label>
        <label>FPS <input name="fps" type="number" min="1" max="30" step="1" value="${a.fps ?? 8}" /></label>
        <button class="btn ghost" type="submit">${t(frameFiles.length ? "sprite.save" : "sprite.slice")}</button>
        ${a.gif ? `<a class="btn ghost" href="${fileUrl(a.gif)}" download="${esc(a.name)}.gif">${t("sprite.gif")}</a>` : ""}
      </form>
      <form class="align-form" data-align="${a.id}">
        <span class="jitter muted">${t("sprite.jitterChecking")}</span>
        <select name="mode" aria-label="${t("sprite.align")}"><option value="bottom">${t("sprite.bottom")}</option><option value="center">${t("sprite.center")}</option></select>
        <button class="btn ghost" type="submit">${t("sprite.alignSubmit")}</button>
      </form>
    </div>`;
}

export function load(a) {
  if (a.assetType !== "sprite_sheet") return;
  loadJitter(a.id);
  if (a.frames?.length) play(a, a.fps ?? 8);
}

/** Preview loop in the browser, so a new FPS can be judged before it is saved. */
let player = 0;
function play(a, fps) {
  clearTimeout(player);
  const img = $("#viewerMeta .sprite-live");
  if (!img) return;
  // Preload so frames don't flicker on the first loop.
  const urls = a.frames.map((f) => `${fileUrl(f)}?t=${Date.now()}`);
  for (const u of urls) new Image().src = u;
  let i = 0;
  const tick = () => {
    if (!img.isConnected) return;
    img.src = urls[(i = (i + 1) % urls.length)];
    player = setTimeout(tick, 1000 / fps);
  };
  player = setTimeout(tick, 1000 / fps);
}

/** How far the content drifts between frames; > 2px is visible as jitter. */
export async function loadJitter(id, mode = "bottom") {
  const el = $("#viewerMeta .jitter");
  try {
    const r = await api(`/api/projects/${state.project.id}/assets/${id}/jitter?mode=${mode}`);
    if (!el?.isConnected) return;
    const worst = Math.max(r.horizontal, r.vertical);
    el.className = `jitter ${worst <= 2 ? "ok" : worst <= 8 ? "warn" : "bad"}`;
    el.textContent = t(mode === "bottom" ? "sprite.jitterBottom" : "sprite.jitter", { h: r.horizontal, v: r.vertical });
  } catch (err) {
    if (el) el.textContent = err.message;
  }
}

export function bind(root, ctx) {
  onSubmit(root, "form[data-slice]", async (form, fd) => {
    const asset = await api(`/api/projects/${state.project.id}/assets/${form.dataset.slice}/slice`, {
      method: "POST",
      body: { frames: Number(fd.get("frames")), fps: Number(fd.get("fps")) },
    });
    ctx.show(asset, t("sprite.saved", { n: asset.frames.length, fps: asset.fps }));
  });
  onSubmit(root, "form[data-align]", async (form, fd) => {
    const { asset, before, after } = await api(`/api/projects/${state.project.id}/assets/${form.dataset.align}/align-frames`, {
      method: "POST",
      body: { mode: fd.get("mode") },
    });
    ctx.show(asset, t("sprite.aligned", { h0: before.horizontal, h1: after.horizontal, v0: before.vertical, v1: after.vertical }));
  });
  root.addEventListener("input", (e) => {
    const form = e.target.closest("form[data-slice]");
    if (!form || e.target.name !== "fps") return;
    const fps = Number(e.target.value);
    const a = state.project.assets.find((x) => x.id === form.dataset.slice);
    if (a?.frames?.length && fps >= 1 && fps <= 30) play(a, fps);
  });
  root.addEventListener("change", (e) => {
    const form = e.target.closest("form[data-align]");
    if (form && e.target.name === "mode") loadJitter(form.dataset.align, e.target.value);
  });
}
