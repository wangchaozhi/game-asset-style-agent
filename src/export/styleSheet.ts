import sharp from "sharp";
import { ASSET_TYPES, isAssetType } from "../domain/assetTypes.js";
import { readProjectFile } from "../store/index.js";
import type { Project, StyleGuide } from "../store/types.js";

/** Approved samples shown per asset type. */
const SAMPLES_PER_TYPE = 6;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Small inline thumbnail so the page is one self-contained file. */
async function dataUri(data: Buffer, max = 480): Promise<string> {
  const webp = await sharp(data).resize(max, max, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  return `data:image/webp;base64,${webp.toString("base64")}`;
}

const RULES: [keyof StyleGuide, string][] = [
  ["rendering", "画法"],
  ["line_and_edges", "线条与边缘"],
  ["lighting_and_shading", "光影"],
  ["perspective", "视角"],
  ["proportions", "比例"],
  ["texture_and_detail", "质感与细节"],
  ["mood", "氛围"],
];

/**
 * A one-page HTML style sheet for people outside the tool (outsourced artists, the team): palette,
 * written rules, references with their notes, and approved samples per type. No scripts; images inline.
 */
export async function buildStyleSheet(project: Project): Promise<string> {
  const sg = project.styleGuide;
  const refs = await Promise.all(project.refs.map(async (r) => ({ note: r.note, src: await dataUri(await readProjectFile(project.id, r.file)) })));
  const superseded = new Set(project.assets.map((a) => a.parentId).filter(Boolean));
  const approved = project.assets.filter((a) => a.status === "approved" && !superseded.has(a.id));
  const groups: { label: string; items: { name: string; src: string }[] }[] = [];
  for (const type of Object.keys(ASSET_TYPES)) {
    const picked = approved.filter((a) => a.assetType === type).slice(-SAMPLES_PER_TYPE);
    if (!picked.length) continue;
    groups.push({
      label: isAssetType(type) ? ASSET_TYPES[type] : type,
      items: await Promise.all(picked.map(async (a) => ({ name: a.name, src: await dataUri(await readProjectFile(project.id, a.file), 360) }))),
    });
  }
  const section = (title: string, body: string) => `<section><h2>${esc(title)}</h2>${body}</section>`;
  const palette = sg?.palette.length
    ? `<ul class="palette">${sg.palette.map((c) => `<li><span class="chip" style="background:${/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "transparent"}"></span><b>${esc(c.hex)}</b><span>${esc(c.role)}</span></li>`).join("")}</ul>`
    : `<p class="muted">还没有色板。</p>`;
  const rules = sg
    ? `<dl class="rules">${RULES.map(([k, label]) => `<dt>${label}</dt><dd>${esc(sg[k])}</dd>`).join("")}</dl>
       ${sg.avoid.length ? `<h3>避免</h3><ul class="avoid">${sg.avoid.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
       <h3>Prompt 前缀</h3><pre>${esc(sg.prompt_prefix)}</pre>`
    : `<p class="muted">还没有风格指南。</p>`;
  const refHtml = refs.length
    ? `<div class="grid refs">${refs.map((r) => `<figure><img src="${r.src}" alt="参考图" />${r.note ? `<figcaption>${esc(r.note)}</figcaption>` : ""}</figure>`).join("")}</div>`
    : `<p class="muted">没有参考图。</p>`;
  const samples = groups.length
    ? groups
        .map((g) => `<h3>${esc(g.label)}</h3><div class="grid">${g.items.map((i) => `<figure><img src="${i.src}" alt="${esc(i.name)}" /><figcaption>${esc(i.name)}</figcaption></figure>`).join("")}</div>`)
        .join("")
    : `<p class="muted">还没有已通过的素材。</p>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(project.name)} · 风格说明书</title>
<style>
  :root { color-scheme: light; --ink: #1d1d1f; --muted: #5f6368; --line: #dadce0; --check: #eeeeee; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 960px; padding: 32px 20px 48px; font: 15px/1.6 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink); background: #fff; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  h2 { margin: 36px 0 12px; font-size: 20px; border-bottom: 2px solid var(--ink); padding-bottom: 4px; }
  h3 { margin: 20px 0 8px; font-size: 16px; }
  .muted, figcaption { color: var(--muted); }
  .summary { font-size: 17px; }
  .palette { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .palette li { display: grid; grid-template-columns: 40px 1fr; grid-template-rows: auto auto; column-gap: 10px; align-items: center; }
  .chip { grid-row: span 2; width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--line); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .palette span:last-child { font-size: 13px; color: var(--muted); }
  .rules { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
  .rules dt { font-weight: 600; }
  .rules dd { margin: 0; }
  pre { white-space: pre-wrap; background: #f6f6f6; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .refs { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  figure { margin: 0; display: grid; gap: 4px; break-inside: avoid; }
  figure img { width: 100%; aspect-ratio: 1; object-fit: contain; border-radius: 8px; border: 1px solid var(--line);
    background: repeating-conic-gradient(var(--check) 0 25%, #fff 0 50%) 0 0 / 16px 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  figcaption { font-size: 13px; }
  footer { margin-top: 40px; font-size: 12px; color: var(--muted); }
  @media print { body { padding: 0; } section { break-inside: avoid-page; } }
</style>
</head>
<body>
<header><h1>${esc(project.name)} · 风格说明书</h1>${sg ? `<p class="summary">${esc(sg.summary)}</p>` : ""}</header>
${section("色板", palette)}
${section("画风规则", rules)}
${section("参考图", refHtml)}
${section("已通过素材样例", samples)}
<footer>由 Game Asset Agent 生成 · ${esc(new Date().toISOString().slice(0, 10))}</footer>
</body>
</html>
`;
}
