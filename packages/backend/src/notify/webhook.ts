export async function sendWebhookNotification(url: string, htmlMessage: string): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: htmlMessage }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Webhook responded with HTTP ${res.status}`);
  }
}
