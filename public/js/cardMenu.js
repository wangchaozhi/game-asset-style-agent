// Context menu on asset cards: right-click, long-press, or Shift+F10 / the menu key on a focused card.
import { $, esc } from "./lib.js";
import { state } from "./state.js";
import { inTrash } from "./assets.js";
import { apply } from "./batch.js";
import { t } from "./i18n.js";

/** Menu entries for an asset: [action, label key], "-" for a separator. Trash items get restore / purge. */
export function menuItems(asset, trash) {
  if (trash) return [["restore", "batch.restore"], ["purge", "batch.purge"]];
  return [
    ["open", "menu.open"],
    "-",
    ...(asset.status === "approved" ? [] : [["approve", "batch.approve"]]),
    ...(asset.status === "rejected" ? [] : [["reject", "batch.reject"]]),
    ...(asset.status === "pending_review" ? [] : [["pending", "menu.pending"]]),
    "-",
    ["tag", "batch.tag"],
    ["rename", "menu.rename"],
    "-",
    ["delete", "batch.delete"],
  ];
}

let openFor = null;

function close(refocus = true) {
  const menu = $("#cardMenu");
  if (menu.hidden) return;
  menu.hidden = true;
  if (refocus) document.querySelector(`#assets .card[data-asset="${CSS.escape(openFor ?? "")}"]`)?.focus();
  openFor = null;
}

function open(card, x, y, onOpen) {
  const id = card.dataset.asset;
  const pool = inTrash() ? (state.project.trash ?? []) : state.project.assets;
  const asset = pool.find((a) => a.id === id);
  if (!asset) return;
  const menu = $("#cardMenu");
  menu.innerHTML = menuItems(asset, inTrash())
    .filter((it, i, all) => it !== "-" || (i > 0 && all[i - 1] !== "-"))
    .map((it) => (it === "-" ? `<li role="separator"></li>` : `<li role="none"><button type="button" role="menuitem" tabindex="-1" data-act="${it[0]}">${esc(t(it[1]))}</button></li>`))
    .join("");
  menu.setAttribute("aria-label", asset.name);
  menu.hidden = false;
  openFor = id;
  menu.onOpen = onOpen;
  // Keep the menu inside the viewport.
  const { width, height } = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - height - 8))}px`;
  menu.querySelector("button").focus();
}

export function bindCardMenu({ onOpen }) {
  const grid = $("#assets");
  const menu = $("#cardMenu");
  grid.addEventListener("contextmenu", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    e.preventDefault();
    open(card, e.clientX, e.clientY, onOpen);
  });
  grid.addEventListener("keydown", (e) => {
    const card = e.target.closest?.(".card");
    if (!card || !((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu")) return;
    e.preventDefault();
    const r = card.getBoundingClientRect();
    open(card, r.left + 12, r.top + 24, onOpen);
  });
  // Long-press on touch screens.
  let timer = 0;
  grid.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    const card = e.target.closest(".card");
    if (!card) return;
    timer = setTimeout(() => open(card, e.clientX, e.clientY, onOpen), 550);
  });
  for (const ev of ["pointerup", "pointercancel", "pointermove"]) grid.addEventListener(ev, () => clearTimeout(timer));

  menu.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const id = openFor;
    close(act !== "open");
    if (act === "open") menu.onOpen(id);
    else apply(act, [id]);
  });
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("[role=menuitem]")];
    const i = items.indexOf(document.activeElement);
    const to = { ArrowDown: (i + 1) % items.length, ArrowUp: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      items[to].focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target)) close(false);
  });
  window.addEventListener("blur", () => close(false));
}
