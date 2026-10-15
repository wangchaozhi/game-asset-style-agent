// Cost & usage: live numbers for the running job and a per-project history dialog.
import { $, api, esc, toast } from "./lib.js";

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

export function fmtCost(c) {
  if (c === null || c === undefined) return "—";
  if (c === 0) return "$0";
  return c < 0.01 ? `<$0.01` : `$${c.toFixed(c < 1 ? 3 : 2)}`;
}

/** Sum token counters across every model a run used. */
export function runTokens(run) {
  const t = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (const u of Object.values(run.claude.byModel)) for (const k in t) t[k] += u[k] ?? 0;
  return t;
}

function costNote(cost) {
  const parts = [];
  if (cost.claude === null) parts.push("模型单价未知");
  if (cost.images === null) parts.push("图像单价未配置");
  return parts.length ? `（${parts.join("，")}，未计入）` : "";
}

/** One-line summary under the run button, updated from SSE `usage` events. */
export function renderLiveUsage(usage) {
  const bar = $("#usageBar");
  if (!usage) {
    bar.hidden = true;
    return;
  }
  const t = runTokens(usage);
  const claude =
    usage.mode === "demo"
      ? `<span>Claude 未调用（演示）</span>`
      : `<span title="输入 / 输出 / 缓存写 / 缓存读">Claude ${usage.claude.requests} 次 · ↑${fmtTokens(t.input_tokens + t.cache_creation_input_tokens + t.cache_read_input_tokens)} ↓${fmtTokens(t.output_tokens)}${t.cache_read_input_tokens ? ` · 缓存命中 ${fmtTokens(t.cache_read_input_tokens)}` : ""}</span>`;
  bar.hidden = false;
  bar.innerHTML = `<span class="usage-label">本次</span>${claude}
    <span>图像 ${usage.images.calls}${usage.budget?.maxImages ? ` / ${usage.budget.maxImages}` : ""} 次${usage.images.failed ? `（失败 ${usage.images.failed}）` : ""}</span>
    <span class="usage-cost" title="估算费用${esc(costNote(usage.cost))}">≈ ${fmtCost(usage.cost.total)}${usage.budget?.maxUsd ? ` / $${usage.budget.maxUsd}` : ""}</span>
    <button class="btn link" data-usage-open>项目用量 ›</button>`;
}

const STATUS = { running: "进行中", ok: "完成", error: "出错", stopped: "已停止", interrupted: "已中断" };

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
      toast(r.removed ? `已清理 ${r.removed} 个文件，释放 ${fmtBytes(r.bytes)}` : "没有需要清理的文件");
      loadStorage(projectId);
    } catch (err) {
      toast(err.message);
    }
  });
}

export async function openUsageDialog(projectId) {
  const dlg = $("#usageDialog");
  const body = $("#usageBody");
  body.innerHTML = `<p class="muted">加载中…</p>`;
  dlg.showModal();
  try {
    const { summary: s, runs } = await api(`/api/projects/${projectId}/usage`);
    const tiles = [
      ["运行次数", s.runs],
      ["Claude 请求", s.claudeRequests],
      ["输入 tokens", fmtTokens(s.tokens.input_tokens + s.tokens.cache_creation_input_tokens + s.tokens.cache_read_input_tokens)],
      ["输出 tokens", fmtTokens(s.tokens.output_tokens)],
      ["图像调用", s.images.calls],
      ["估算费用", fmtCost(s.cost.total)],
    ];
    const totalIn = s.tokens.input_tokens + s.tokens.cache_creation_input_tokens + s.tokens.cache_read_input_tokens;
    const hit = totalIn ? Math.round((s.tokens.cache_read_input_tokens / totalIn) * 100) : 0;
    body.innerHTML = `
      <div class="usage-tiles">${tiles.map(([k, v]) => `<div class="tile"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
      <p class="muted usage-foot">Claude ${fmtCost(s.cost.claude)} · 图像 ${fmtCost(s.cost.images)} · 缓存命中率 ${hit}%${esc(costNote(s.cost))}</p>
      ${
        runs.length
          ? `<div class="usage-table-wrap"><table class="usage-table">
        <thead><tr><th>时间</th><th>需求</th><th>状态</th><th>Claude</th><th>输入/输出</th><th>图像</th><th>费用</th></tr></thead>
        <tbody>${runs
          .map((r) => {
            const t = runTokens(r);
            return `<tr>
              <td>${new Date(r.startedAt).toLocaleString()}</td>
              <td class="req" title="${esc(r.request)}">${esc(r.request || "（按所选类型生成）")}</td>
              <td><span class="run-status ${r.status}">${STATUS[r.status] ?? r.status}</span></td>
              <td>${r.mode === "demo" ? "演示" : `${r.claude.requests} 次`}</td>
              <td>${fmtTokens(t.input_tokens + t.cache_creation_input_tokens + t.cache_read_input_tokens)} / ${fmtTokens(t.output_tokens)}</td>
              <td>${r.images.calls}${r.images.failed ? ` <span class="bad">(${r.images.failed}✗)</span>` : ""}</td>
              <td>${fmtCost(r.cost.total)}</td>
            </tr>`;
          })
          .join("")}</tbody></table></div>`
          : `<p class="muted">还没有运行记录。</p>`
      }
      <p class="muted usage-foot">费用按 Claude 官方单价估算；图像单价通过环境变量 IMAGE_PRICE_OPENAI / IMAGE_PRICE_GEMINI（美元/张）配置。</p>
      <div class="usage-storage muted"><span>磁盘占用 <b id="storageBytes">…</b></span>
        <button class="btn link" data-cleanup title="删除不属于任何素材或参考图的文件">清理无主文件</button></div>`;
    loadStorage(projectId);
  } catch (e) {
    body.innerHTML = `<p class="bad">${esc(e.message)}</p>`;
  }
}
