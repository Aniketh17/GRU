import "./styles.css";

const status = document.getElementById("status") as HTMLParagraphElement;
const logout = document.getElementById("logout") as HTMLButtonElement;

async function boot(): Promise<void> {
  try {
    const res = await fetch("/api/health", { headers: { "X-App": "gru" } });
    if (res.status === 401) return location.replace("/login");
    if (res.status === 423) return location.replace("/locked");
    if (!res.ok) throw new Error(String(res.status));
    const h = (await res.json()) as { paused: boolean; locked: boolean };
    if (h.locked) return location.replace("/locked");
    status.textContent = h.paused ? "Signed in. Sync is paused." : "Signed in. Foundations are in place.";
    logout.hidden = false;
  } catch {
    status.textContent = "Couldn't reach GRU. Pull to refresh or try again shortly.";
  }
}

logout.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST", headers: { "Content-Type": "application/json", "X-App": "gru" }, body: "{}" });
  location.replace("/login");
});

void boot();
