// Cost & usage: live numbers for the running job, and a per-project dialog with progress stats and run history.
import { $, api, esc, toast } from "./lib.js";
import { state } from "./state.js";
import { t, typeLabel } from "./i18n.js";

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export function fmtCost(c) {
  if (c === null || c === undefined) return "—";
  if (c === 0) return "$0";
  return c < 0.01 ? `<$0.01` : `$${c.toFixed(c < 1 ? 3 : 2)}`;
}

/** Sum token counters across every model a run used. */
export function runTokens(run) {
  const tok = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const u of Object.values(run.claude.byModel)) for (const k in tok) tok[k] += u[k] ?? 0;
  return tok;
}

function costNote(cost) {
  const parts = [];
  if (cost.claude === null) parts.push(t("usage.noModelPrice"));
  if (cost.images === null) parts.push(t("usage.noImagePrice"));
  return parts.length ? t("usage.notCounted", { what: parts.join(t("usage.sep")) }) : "";
}

/** One-line summary under the run button, updated from SSE `usage` events. */
export function renderLiveUsage(usage) {
  const bar = $("#usageBar");
  if (!usage) {
    bar.hidden = true;
    return;
  }
  const tok = runTokens(usage);
  const claude =
    usage.mode !== "agent"
      ? `<span>${t("usage.noClaude", { mode: t(usage.mode === "manual" ? "usage.manual" : "usage.demo") })}</span>`
      : `<span title="${t("usage.tokensTitle")}">${t("usage.claudeCalls", { n: usage.claude.requests })} · ↑${fmtTokens(tok.input_tokens + tok.cache_creation_input_tokens + tok.cache_read_input_tokens)} ↓${fmtTokens(tok.output_tokens)}${tok.cache_read_input_tokens ? ` · ${t("usage.cacheHit", { n: fmtTokens(tok.cache_read_input_tokens) })}` : ""}</span>`;
  bar.hidden = false;
  bar.innerHTML = `<span class="usage-label">${t("usage.thisRun")}</span>${claude}
    <span>${t("usage.images", { n: `${usage.images.calls}${usage.budget?.maxImages ? ` / ${usage.budget.maxImages}` : ""}` })}${usage.images.failed ? t("usage.failed", { n: usage.images.failed }) : ""}</span>
    <span class="usage-cost" title="${t("usage.estCost")}${esc(costNote(usage.cost))}">≈ ${fmtCost(usage.cost.total)}${usage.budget?.maxUsd ? ` / $${usage.budget.maxUsd}` : ""}</span>
    <button class="btn link" data-usage-open>${t("usage.project")} ›</button>`;
}

const RUN_STATUSES = new Set(["running", "ok", "error", "stopped", "interrupted"]);

const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function loadStorage(projectId) {
  const el = $("#storageBytes");
  try {
    const { bytes } = await api(`/api/projects/${projectId}/storage`);
    if (el?.isConnected) el.textContent = fmtBytes(bytes);
  } catch {
    if (el?.isConnected) el.textContent = "—";
  }
}

export function bindUsageDialog(getProjectId) {
  $("#usageBody").addEventListener("click", async (e) => {
    if (!e.target.closest("[data-cleanup]")) return;
    const projectId = getProjectId();
    try {
      const r = await api(`/api/projects/${projectId}/cleanup`, { method: "POST" });
      toast(r.removed ? t("usage.cleaned", { n: r.removed, size: fmtBytes(r.bytes) }) : t("usage.nothingToClean"));
      loadStorage(projectId);
    } catch (err) {
      toast(err.message);
    }
  });
}

/** Project progress: status split, approval rate, score, per-type counts. */
function statsHtml(st) {
  const pct = (x) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const seg = (n, cls, label) => (n ? `<i class="${cls}" style="flex:${n}" title="${label} ${n}"></i>` : "");
  const types = st.byType
    .map((x) => `<tr><td>${esc(typeLabel(x.type, state.config.assetTypes[x.type]))}</td><td>${x.current}</td><td>${x.approved}</td></tr>`)
    .join("");
  return `<h4 class="usage-sub">${t("usage.progress")}</h4>
    <div class="usage-tiles">
      <div class="tile"><span>${t("usage.current")}</span><b>${st.current}</b></div>
      <div class="tile"><span>${t("filter.approved")}</span><b>${st.byStatus.approved}</b></div>
      <div class="tile"><span>${t("usage.rate")}</span><b>${pct(st.approvalRate)}</b></div>
      <div class="tile"><span>${t("usage.meanScore")}</span><b>${st.meanScore ?? "—"}</b></div>
      <div class="tile"><span>${t("usage.perApproved")}</span><b>${st.costPerApproved === null ? "—" : fmtCost(st.costPerApproved)}</b></div>
    </div>
    ${st.current ? `<div class="stat-bar" role="img" aria-label="${t("usage.split", { a: st.byStatus.approved, p: st.byStatus.pending_review, r: st.byStatus.rejected })}">${seg(st.byStatus.approved, "ok", t("filter.approved"))}${seg(st.byStatus.pending_review, "pending", t("filter.pending_review"))}${seg(st.byStatus.rejected, "bad", t("filter.rejected"))}</div>
      <p class="muted usage-foot">${t("usage.foot", { a: st.byStatus.approved, p: st.byStatus.pending_review, r: st.byStatus.rejected, v: st.variants, o: st.superseded, d: st.trashed })}</p>` : ""}
    ${types ? `<div class="usage-table-wrap"><table class="usage-table"><thead><tr><th>${t("usage.type")}</th><th>${t("usage.currentCol")}</th><th>${t("filter.approved")}</th></tr></thead><tbody>${types}</tbody></table></div>` : ""}`;
}

export async function openUsageDialog(projectId) {
  const dlg = $("#usageDialog");
  const body = $("#usageBody");
  body.innerHTML = `<p class="muted">${t("common.loading")}</p>`;
  dlg.showModal();
  try {
    const [{ summary: s, runs }, st] = await Promise.all([api(`/api/projects/${projectId}/usage`), api(`/api/projects/${projectId}/stats`)]);
    const tiles = [
      [t("usage.runs"), s.runs],
      [t("usage.claudeRequests"), s.claudeRequests],
      [t("usage.inTokens"), fmtTokens(s.tokens.input_tokens + s.tokens.cache_creation_input_tokens + s.tokens.cache_read_input_tokens)],
      [t("usage.outTokens"), fmtTokens(s.tokens.output_tokens)],
      [t("usage.imageCalls"), s.images.calls],
      [t("usage.estCost"), fmtCost(s.cost.total)],
    ];
    const totalIn = s.tokens.input_tokens + s.tokens.cache_creation_input_tokens + s.tokens.cache_read_input_tokens;
    const hit = totalIn ? Math.round((s.tokens.cache_read_input_tokens / totalIn) * 100) : 0;
    body.innerHTML = `
      ${statsHtml(st)}
      <h4 class="usage-sub">${t("usage.cost")}</h4>
      <div class="usage-tiles">${tiles.map(([k, v]) => `<div class="tile"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
      <p class="muted usage-foot">${t("usage.costFoot", { c: fmtCost(s.cost.claude), i: fmtCost(s.cost.images), hit })}${esc(costNote(s.cost))}</p>
      ${
        runs.length
          ? `<div class="usage-table-wrap"><table class="usage-table">
        <thead><tr><th>${t("usage.time")}</th><th>${t("usage.request")}</th><th>${t("usage.status")}</th><th>Claude</th><th>${t("usage.inOut")}</th><th>${t("usage.imagesCol")}</th><th>${t("usage.costCol")}</th></tr></thead>
        <tbody>${runs
          .map((r) => {
            const tok = runTokens(r);
            return `<tr>
              <td>${new Date(r.startedAt).toLocaleString()}</td>
              <td class="req" title="${esc(r.request)}">${esc(r.request || t("usage.byTypes"))}</td>
              <td><span class="run-status ${r.status}">${RUN_STATUSES.has(r.status) ? t(`run.status.${r.status}`) : esc(r.status)}</span></td>
              <td>${r.mode === "demo" ? t("usage.demo") : r.mode === "manual" ? t("usage.manual") : t("usage.times", { n: r.claude.requests })}</td>
              <td>${fmtTokens(tok.input_tokens + tok.cache_creation_input_tokens + tok.cache_read_input_tokens)} / ${fmtTokens(tok.output_tokens)}</td>
              <td>${r.images.calls}${r.images.failed ? ` <span class="bad">(${r.images.failed}✗)</span>` : ""}</td>
              <td>${fmtCost(r.cost.total)}</td>
            </tr>`;
          })
          .join("")}</tbody></table></div>`
          : `<p class="muted">${t("usage.noRuns")}</p>`
      }
      <p class="muted usage-foot">${t("usage.priceNote")}</p>
      <div class="usage-storage muted"><span>${t("usage.disk")} <b id="storageBytes">…</b></span>
        <button class="btn link" data-cleanup title="${t("usage.cleanupTitle")}">${t("usage.cleanup")}</button></div>`;
    loadStorage(projectId);
  } catch (e) {
    body.innerHTML = `<p class="bad">${esc(e.message)}</p>`;
  }
}
