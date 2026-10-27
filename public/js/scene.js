// Scene layout preview: place approved assets on a background to judge the set together; download as PNG.
import { $, esc } from "./lib.js";
import { fileUrl, state, thumbUrl } from "./state.js";

const W = 1280;
const H = 720;
/** Starting height of a newly placed sprite, by type (px on the 1280×720 stage). */
const START_HEIGHT = { character: 200, enemy: 180, sprite_sheet: 160, prop: 140, item_icon: 64, ui: 96, vfx: 160, portrait: 220, tile: 96 };
const STEP = 1.15;

/** { bg: "color:#hex" | "asset:<id>", items: [{ id, x, y, h, flip }] } per project, kept in this browser. */
let scene = null;
let selected = -1;
const images = new Map();

const key = () => `gaa.scene.${state.project.id}`;
function loadScene() {
  try {
    scene = JSON.parse(localStorage.getItem(key()) ?? "null");
  } catch {
    scene = null;
  }
  if (!scene || !Array.isArray(scene.items)) scene = { bg: "color:#9fc6a0", items: [] };
  const ids = new Set(state.project.assets.map((a) => a.id));
  scene.items = scene.items.filter((i) => ids.has(i.id));
}
function saveScene() {
  try {
    localStorage.setItem(key(), JSON.stringify(scene));
  } catch {}
}

const assetOf = (id) => state.project.assets.find((a) => a.id === id);
/** Sprite sheets show their first frame. */
const srcOf = (a) => fileUrl(a.frames?.[0] ?? a.file);

function image(a) {
  const src = srcOf(a);
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = draw;
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** Bounding box of an item on the stage. */
function box(item) {
  const img = image(assetOf(item.id));
  const w = img ? (img.naturalWidth / img.naturalHeight) * item.h : item.h;
  return { x: item.x - w / 2, y: item.y - item.h, w, h: item.h };
}

function drawBackground(g) {
  if (scene.bg.startsWith("color:")) {
    g.fillStyle = scene.bg.slice(6);
    g.fillRect(0, 0, W, H);
    return;
  }
  const a = assetOf(scene.bg.slice(6));
  const img = a && image(a);
  g.fillStyle = "#cccccc";
  g.fillRect(0, 0, W, H);
  if (!img) return;
  if (a.assetType === "tile") {
    // Tiles repeat at 96px, a typical on-screen tile size at this stage size.
    for (let y = 0; y < H; y += 96) for (let x = 0; x < W; x += 96) g.drawImage(img, x, y, 96, 96);
  } else {
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    g.drawImage(img, (W - img.naturalWidth * s) / 2, (H - img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
  }
}

function draw() {
  const canvas = $("#sceneCanvas");
  if (!canvas || !scene) return;
  const g = canvas.getContext("2d");
  g.imageSmoothingEnabled = !state.pixelKernel;
  drawBackground(g);
  // Lower on screen = nearer: draw in order of the feet's y.
  const order = scene.items.map((item, i) => [item, i]).sort((a, b) => a[0].y - b[0].y);
  for (const [item, i] of order) {
    const img = image(assetOf(item.id));
    if (!img) continue;
    const b = box(item);
    g.save();
    if (item.flip) {
      g.translate(b.x + b.w, b.y);
      g.scale(-1, 1);
      g.drawImage(img, 0, 0, b.w, b.h);
    } else g.drawImage(img, b.x, b.y, b.w, b.h);
    g.restore();
    if (i === selected) {
      g.strokeStyle = "#ff6a00";
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.strokeRect(b.x, b.y, b.w, b.h);
      g.setLineDash([]);
    }
  }
  $("#sceneTools").hidden = selected < 0;
}

function changed() {
  saveScene();
  draw();
}

function open() {
  loadScene();
  selected = -1;
  const usable = state.project.assets.filter((a) => a.status === "approved");
  const bgs = usable.filter((a) => a.assetType === "background" || a.assetType === "tile");
  const sprites = usable.filter((a) => a.assetType !== "background");
  $("#sceneBg").innerHTML = [
    ["color:#9fc6a0", "草地绿"], ["color:#2b2d42", "夜色"], ["color:#f2e8cf", "米白"], ["color:#ffffff", "白色"],
    ...bgs.map((a) => [`asset:${a.id}`, `${a.assetType === "tile" ? "瓦片平铺" : "背景"}：${a.name}`]),
  ]
    .map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`)
    .join("");
  if (![...$("#sceneBg").options].some((o) => o.value === scene.bg)) scene.bg = "color:#9fc6a0";
  $("#sceneBg").value = scene.bg;
  $("#scenePalette").innerHTML = sprites.length
    ? sprites
        .map((a) => `<button type="button" class="checker" data-add="${a.id}" title="放入：${esc(a.name)}"><img src="${thumbUrl(a.frames?.[0] ?? a.file, 160)}" alt="${esc(a.name)}" /></button>`)
        .join("")
    : `<p class="muted">还没有已通过的素材</p>`;
  $("#sceneDialog").showModal();
  draw();
}

/** Stage coordinates of a pointer event. */
function stagePoint(e) {
  const r = $("#sceneCanvas").getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

function hit(p) {
  // Topmost first: reverse of the draw order.
  const order = scene.items.map((item, i) => [item, i]).sort((a, b) => b[0].y - a[0].y);
  for (const [item, i] of order) {
    const b = box(item);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return i;
  }
  return -1;
}

function act(action) {
  const item = scene.items[selected];
  if (!item) return;
  if (action === "bigger") item.h = Math.min(H, item.h * STEP);
  else if (action === "smaller") item.h = Math.max(16, item.h / STEP);
  else if (action === "flip") item.flip = !item.flip;
  else if (action === "copy") {
    scene.items.push({ ...item, x: Math.min(W, item.x + 40) });
    selected = scene.items.length - 1;
  } else if (action === "remove") {
    scene.items.splice(selected, 1);
    selected = -1;
  }
  changed();
}

export function bindScene() {
  $("#sceneBtn").addEventListener("click", open);
  $("#sceneBg").addEventListener("change", (e) => {
    scene.bg = e.target.value;
    changed();
  });
  $("#scenePalette").addEventListener("click", (e) => {
    const id = e.target.closest("[data-add]")?.dataset.add;
    const a = id && assetOf(id);
    if (!a) return;
    // Spread new items along the ground line so they don't stack.
    scene.items.push({ id, x: 160 + ((scene.items.length * 150) % (W - 320)), y: H - 120, h: START_HEIGHT[a.assetType] ?? 128, flip: false });
    selected = scene.items.length - 1;
    changed();
  });
  $("#sceneTools").addEventListener("click", (e) => e.target.dataset.act && act(e.target.dataset.act));
  $("#sceneClear").addEventListener("click", () => {
    scene.items = [];
    selected = -1;
    changed();
  });
  $("#sceneDownload").addEventListener("click", () => {
    const was = selected;
    selected = -1; // no selection outline in the export
    draw();
    $("#sceneCanvas").toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${state.project.name}_场景预览.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      selected = was;
      draw();
    }, "image/png");
  });

  const canvas = $("#sceneCanvas");
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    const p = stagePoint(e);
    selected = hit(p);
    if (selected >= 0) {
      const item = scene.items[selected];
      drag = { dx: p.x - item.x, dy: p.y - item.y };
      canvas.setPointerCapture(e.pointerId);
    }
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || selected < 0) return;
    const p = stagePoint(e);
    const item = scene.items[selected];
    item.x = Math.max(0, Math.min(W, p.x - drag.dx));
    item.y = Math.max(0, Math.min(H, p.y - drag.dy));
    draw();
  });
  canvas.addEventListener("pointerup", () => {
    if (drag) saveScene();
    drag = null;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (selected < 0) return;
      e.preventDefault();
      act(e.deltaY < 0 ? "bigger" : "smaller");
    },
    { passive: false },
  );
  $("#sceneDialog").addEventListener("keydown", (e) => {
    if (e.target.closest("select, input")) return;
    if (selected < 0 && (e.key === "[" || e.key === "]") && scene.items.length) {
      selected = 0;
      draw();
      return e.preventDefault();
    }
    if (selected < 0) return;
    const step = e.shiftKey ? 32 : 4;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      const item = scene.items[selected];
      item.x = Math.max(0, Math.min(W, item.x + moves[e.key][0]));
      item.y = Math.max(0, Math.min(H, item.y + moves[e.key][1]));
      changed();
    } else if (e.key === "[" || e.key === "]") {
      selected = (selected + (e.key === "]" ? 1 : scene.items.length - 1)) % scene.items.length;
      draw();
    } else if (e.key === "Delete" || e.key === "Backspace") act("remove");
    else if (e.key === "+" || e.key === "=") act("bigger");
    else if (e.key === "-") act("smaller");
    else if (e.key.toLowerCase() === "f") act("flip");
    else return;
    e.preventDefault();
  });
}
