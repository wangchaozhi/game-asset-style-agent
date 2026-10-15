// Tell the user a run finished when they are looking elsewhere: tab title, and optionally a system notification.
import { $ } from "./lib.js";

const BASE_TITLE = document.title;
const KEY = "gaa.notify";

let pendingTitle = false;

function restoreTitle() {
  if (!document.hidden) {
    document.title = BASE_TITLE;
    pendingTitle = false;
  }
}

export function jobStarted() {
  document.title = `⏳ 生成中 · ${BASE_TITLE}`;
}

/** Progress in the title, e.g. "(3) 生成中". */
export function jobProgress(assetsMade) {
  if (assetsMade) document.title = `⏳ (${assetsMade}) 生成中 · ${BASE_TITLE}`;
}

export function jobFinished({ ok, made, message }) {
  const text = ok ? `生成完成${made ? `：${made} 个新素材` : ""}` : `运行出错：${message ?? ""}`;
  if (!document.hidden) {
    document.title = BASE_TITLE;
    return;
  }
  // Stay visible in the tab strip until the user comes back.
  document.title = `${ok ? "✓" : "✗"} ${text} · ${BASE_TITLE}`;
  pendingTitle = true;
  let enabled = false;
  try { enabled = localStorage.getItem(KEY) === "1"; } catch {}
  if (enabled && "Notification" in window && Notification.permission === "granted") {
    const n = new Notification("Game Asset Agent", { body: text, tag: "gaa-run" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
}

export function bindNotify() {
  document.addEventListener("visibilitychange", () => pendingTitle && restoreTitle());
  const box = $("#notifyToggle");
  if (!("Notification" in window)) {
    box.closest("label").hidden = true;
    return;
  }
  try { box.checked = localStorage.getItem(KEY) === "1" && Notification.permission === "granted"; } catch {}
  box.addEventListener("change", async () => {
    let on = box.checked;
    if (on && Notification.permission !== "granted") on = (await Notification.requestPermission()) === "granted";
    box.checked = on;
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch {}
  });
}
