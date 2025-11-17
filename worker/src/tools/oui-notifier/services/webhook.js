import { safeText } from "../utils.js";

export async function sendWebhook(webhookUrl, payload) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await safeText(res);
    console.error(
      `Webhook delivery failed to ${webhookUrl}:`,
      res.status,
      body
    );
    return false;
  }

  return true;
}
