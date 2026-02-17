export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isLikelyBase58(str) {
  if (!str || str.length < 32 || str.length > 64) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(str);
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}

/**
 * Validate a webhook URL: must be http(s) and not point to private/reserved IP ranges.
 * Returns the validated URL string, or null with an error message.
 */
export function validateWebhookUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return { url: null, error: "Webhook URL is not a valid URL." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { url: null, error: "Webhook URL must be HTTP or HTTPS." };
  }
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "[::1]" ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host)
  ) {
    return { url: null, error: "Webhook URL must not point to a private or reserved address." };
  }
  return { url: u.toString(), error: null };
}

export function pickThreshold(daysRemaining, lastNotifiedLevel) {
  if (daysRemaining <= 1  && (lastNotifiedLevel === 0 || lastNotifiedLevel > 1))  return 1;
  if (daysRemaining <= 7  && (lastNotifiedLevel === 0 || lastNotifiedLevel > 7))  return 7;
  if (daysRemaining <= 14 && (lastNotifiedLevel === 0 || lastNotifiedLevel > 14)) return 14;
  return null;
}
