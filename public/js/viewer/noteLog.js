// Review notes over time: who said what, when, with which verdict.
import { esc } from "../lib.js";
import { t } from "../i18n.js";

/** Shown once there is more than the current note (which the header already shows). */
export function html(a) {
  const log = a.noteLog ?? [];
  if (log.length < 2) return "";
  return `<details class="note-log">
    <summary><b>${t("noteLog.title")}</b> <span class="muted">${t("noteLog.count", { n: log.length })}</span></summary>
    <ol>${[...log]
      .reverse()
      .map(
        (n) => `<li><span class="muted">${esc(new Date(n.at).toLocaleString())} · ${esc(t(n.by === "user" ? "viewer.myNotes" : "viewer.agentNotes"))} · ${esc(t(`filter.${n.status}`))}${n.score ? ` ${n.score}/10` : ""}</span>
          <span>${esc(n.notes)}</span></li>`,
      )
      .join("")}</ol>
  </details>`;
}
