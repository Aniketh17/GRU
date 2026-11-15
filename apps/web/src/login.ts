import { deriveProof, type KdfParams } from "./derive.ts";
import "./styles.css";

const form = document.getElementById("login-form") as HTMLFormElement;
const userEl = document.getElementById("username") as HTMLInputElement;
const passEl = document.getElementById("password") as HTMLInputElement;
const button = document.getElementById("submit") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;

function say(text: string, kind: "info" | "error" = "info"): void {
  status.textContent = text;
  status.dataset.kind = kind;
}

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const u = userEl.value.trim();
  const password = passEl.value;
  if (!u || !password) return say("Enter your username and password, Ani.", "error");

  button.disabled = true;
  try {
    say("Checking…");
    const pr = await fetch(`/auth/params?u=${encodeURIComponent(u)}`, { headers: { "X-App": "gru" } });
    if (pr.status === 423) return location.replace("/locked");
    if (!pr.ok) return say("GRU isn't set up yet. Run the setup steps first.", "error");
    const params = (await pr.json()) as KdfParams;

    say("Securing your password on this device…");
    const p = await deriveProof(password, params);

    const res = await fetch("/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-App": "gru" },
      body: JSON.stringify({ u, p }),
    });
    if (res.ok) {
      passEl.value = "";
      return location.replace("/");
    }
    if (res.status === 429) {
      const secs = Number(res.headers.get("Retry-After") ?? "900");
      return say(`Too many attempts. Try again in ${Math.max(1, Math.ceil(secs / 60))} min.`, "error");
    }
    if (res.status === 423) return location.replace("/locked");
    say("That username or password isn't right.", "error");
  } catch {
    say("Couldn't reach GRU. Check your connection and try again.", "error");
  } finally {
    button.disabled = false;
  }
});
