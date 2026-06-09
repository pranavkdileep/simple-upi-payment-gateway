export async function fireWebhook(
  kv: KVNamespace,
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
    await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ event, ...data }),
    });
  } catch {
    // fire-and-forget
  }
}
