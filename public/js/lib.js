// Shared DOM / HTTP helpers for the front-end modules.
import { getLang } from "./i18n.js";

export const $ = (s) => document.querySelector(s);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function api(path, opts = {}) {
  const json = opts.body && !(opts.body instanceof FormData);
  const res = await fetch(path, {
    ...opts,
    // Server-generated text (notes, drift reasons, errors) follows the interface language.
    headers: { "Accept-Language": getLang(), ...(json ? { "Content-Type": "application/json" } : {}) },
    body: json ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  // Session expired or token changed on the server: back to the login page.
  if (res.status === 401 && data.login) location.href = "/login.html";
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { data });
  return data;
}

export function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}
