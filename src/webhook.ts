import { logToD1 } from "./log";

export async function fireWebhook(
  kv: KVNamespace,
  db: D1Database,
  event: string,
  data: Record<string, unknown>
) {
  try {
    const [url, secret] = await Promise.all([
      kv.get("webhook_url"),
      kv.get("webhook_secret"),
    ]);
    if (!url) return;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret) headers["X-Webhook-Secret"] = secret;
    const body = JSON.stringify({ event, ...data });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { method: "POST", headers, body });
        const json: any = await res.json();
        if (json?.success === true) return;
      } catch {
        // retry
      }
    }

    await logToD1(db, `Webhook failed after 3 attempts: ${event} -> ${url}`, "WebhookFail");
  } catch {
    // fatal — no db to log to
  }
}
