import "./styles.css";

const title = document.getElementById("title") as HTMLHeadingElement;
const body = document.getElementById("body") as HTMLParagraphElement;

async function boot(): Promise<void> {
  try {
    const res = await fetch("/api/health", { headers: { "X-App": "gru" } });
    const data = (await res.json().catch(() => ({}))) as { state?: string; locked?: boolean };
    if (res.status === 423 && data.state === "wiped") {
      title.textContent = "GRU has been wiped";
      body.textContent = "All data was removed and Gmail access revoked. Nothing is readable through GRU any more. To start again, follow SETUP.md.";
      return;
    }
    if (res.status === 423 && data.state === "wiping") {
      title.textContent = "Wipe in progress";
      body.textContent = "GRU is deleting your data. Check back in a minute.";
      return;
    }
    if (res.status === 401) return location.replace("/login");
    if (res.ok && !data.locked) return location.replace("/");
  } catch {
    /* fall through to the locked message */
  }
  title.textContent = "GRU is locked";
  body.textContent = "Your data is encrypted and the keys are not loaded. Run scripts/unlock.ts with the keys from your password manager.";
}

void boot();
