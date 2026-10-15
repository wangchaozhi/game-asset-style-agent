// Access-token login: exchange the token for a session cookie, then go back to the app.
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
  error.textContent = (await res.json().catch(() => ({}))).error || `登录失败（HTTP ${res.status}）`;
  error.hidden = false;
  form.token.select();
});
