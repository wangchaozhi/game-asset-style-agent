// Access-token login: exchange the token for a session cookie, then go back to the app.
import { applyI18n, t } from "./i18n.js";

applyI18n();
document.title = `${t("login.title")} · Game Asset Agent`;
const form = document.querySelector("#loginForm");
const error = document.querySelector("#loginError");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.hidden = true;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: form.token.value }),
  });
  if (res.ok) return location.replace("/");
  error.textContent = (await res.json().catch(() => ({}))).error || t("login.failed", { status: res.status });
  error.hidden = false;
  form.token.select();
});
