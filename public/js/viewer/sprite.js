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
          ? `<div class="checker sprite-gif"><div class="sprite-stage">
              <img class="onion prev" alt="" hidden /><img class="onion next" alt="" hidden />
              <img class="sprite-live" src="${fileUrl(frameFiles[0])}?t=${Date.now()}" alt="${t("sprite.preview")}" /></div></div>
            <div class="sprite-controls" role="toolbar" aria-label="${t("sprite.controls")}">
              <button type="button" class="btn link" data-frame-step="-1" title="${t("sprite.prevTitle")}" aria-label="${t("sprite.prevTitle")}">◀</button>
              <button type="button" class="btn link" data-play title="${t("sprite.pauseTitle")}">${t("sprite.pause")}</button>
              <button type="button" class="btn link" data-frame-step="1" title="${t("sprite.nextTitle")}" aria-label="${t("sprite.nextTitle")}">▶</button>
              <span class="frame-no muted" aria-live="polite"></span>
              <label class="toggle" title="${t("sprite.onionTitle")}"><input type="checkbox" data-onion ${player.onion ? "checked" : ""} /> ${t("sprite.onion")}</label>
            </div>`
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

/** The frames either side of `i` in a looping animation of `n` frames (an onion skin shows both). */
export const neighbours = (i, n) => ({ prev: (i - 1 + n) % n, next: (i + 1) % n });

/**
 * Preview player: plays at the slider's FPS (so a new rate can be judged before saving), pauses,
 * steps frame by frame and can overlay the neighbouring frames. Onion skin is remembered across assets.
 */
const player = { timer: 0, urls: [], i: 0, fps: 8, playing: true, onion: false };

function show() {
  const img = $("#viewerMeta .sprite-live");
  if (!img?.isConnected || !player.urls.length) return false;
  const n = player.urls.length;
  img.src = player.urls[player.i];
  const { prev, next } = neighbours(player.i, n);
  const skins = [[".onion.prev", prev], [".onion.next", next]];
  for (const [sel, j] of skins) {
    const el = $(`#viewerMeta ${sel}`);
    el.hidden = !player.onion || n < 2;
    if (!el.hidden) el.src = player.urls[j];
  }
  $("#viewerMeta .frame-no").textContent = t("sprite.frameNo", { i: player.i + 1, n });
  const btn = $("#viewerMeta [data-play]");
  btn.textContent = t(player.playing ? "sprite.pause" : "sprite.play");
  btn.title = t(player.playing ? "sprite.pauseTitle" : "sprite.playTitle");
  return true;
}

function schedule() {
  clearTimeout(player.timer);
  if (!player.playing) return;
  player.timer = setTimeout(() => {
    player.i = (player.i + 1) % player.urls.length;
    if (show()) schedule();
  }, 1000 / player.fps);
}

/** Start the preview for a freshly opened asset (frames are re-fetched: slicing rewrites them in place). */
function play(a, fps) {
  const urls = a.frames.map((f) => `${fileUrl(f)}?t=${Date.now()}`);
  // Preload so frames don't flicker on the first loop.
  for (const u of urls) new Image().src = u;
  Object.assign(player, { urls, i: 0, fps, playing: true });
  show();
  schedule();
}

/** Step one frame (pausing playback), for the buttons and the , / . keys. */
export function stepFrame(dir) {
  if (!$("#viewerMeta .sprite-live")?.isConnected || !player.urls.length) return false;
  player.playing = false;
  player.i = (player.i + dir + player.urls.length) % player.urls.length;
  show();
  schedule();
  return true;
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
    if (!(fps >= 1 && fps <= 30)) return;
    // A new rate takes effect in place, without restarting the animation.
    player.fps = fps;
    schedule();
  });
  root.addEventListener("click", (e) => {
    const step = e.target.closest("[data-frame-step]");
    if (step) return void stepFrame(Number(step.dataset.frameStep));
    if (!e.target.closest("[data-play]")) return;
    player.playing = !player.playing;
    show();
    schedule();
  });
  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-onion]")) {
      player.onion = e.target.checked;
      return void show();
    }
    const form = e.target.closest("form[data-align]");
    if (form && e.target.name === "mode") loadJitter(form.dataset.align, e.target.value);
  });
}
