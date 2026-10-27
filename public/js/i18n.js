// Interface language: Chinese and English, from the saved choice, else the browser's languages. Static text in index.html is marked with
// data-i18n (text), data-i18n-title, data-i18n-placeholder and data-i18n-aria (aria-label);
// scripts use t(key, vars) when they render. The choice is remembered per browser.

import zh from "./i18n/zh.js";
import en from "./i18n/en.js";

const KEY = "gaa.lang";

export const DICT = { zh, en };

export const LANGS = Object.keys(DICT);

function saved() {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.includes(v) ? v : null;
  } catch {
    return null;
  }
}

/** First language in the browser's list we have: Chinese for any zh-*, else English. */
export function defaultLang(languages = []) {
  for (const l of languages) {
    const base = String(l).toLowerCase().split("-")[0];
    if (LANGS.includes(base)) return base;
  }
  return "en";
}

let lang = saved() ?? defaultLang(globalThis.navigator?.languages ?? []);

export const getLang = () => lang;

/** The text for `key` in the current language, with {name} placeholders filled; falls back to Chinese, then the key. */
export function t(key, vars) {
  const s = DICT[lang][key] ?? DICT.zh[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Whether `key` has a translation (own keys only, so "constructor" and friends are not). */
export const has = (key) => Object.hasOwn(DICT.zh, key);

/** Display label of an asset type in the current language (the server's label for unknown types). */
export const typeLabel = (type, fallback) => (has(`type.${type}`) ? t(`type.${type}`) : (fallback ?? type));

const ATTRS = { i18n: null, i18nTitle: "title", i18nPlaceholder: "placeholder", i18nAria: "aria-label" };

/** Fill every marked element under `root` with the current language's text. */
export function applyI18n(root = document) {
  root.documentElement?.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
  for (const [data, attr] of Object.entries(ATTRS)) {
    const sel = `[data-${data.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}]`;
    for (const el of root.querySelectorAll(sel)) {
      const text = t(el.dataset[data]);
      if (attr) el.setAttribute(attr, text);
      else el.textContent = text;
    }
  }
}

/** Switch language, remember it, refresh static text and tell renderers ("gaa:lang"). */
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  applyI18n();
  document.dispatchEvent(new CustomEvent("gaa:lang", { detail: { lang } }));
}
