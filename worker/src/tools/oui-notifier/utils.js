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

export function computeLastDayBurn(rows) {
  if (!rows || rows.length < 2) return 0;

  // Look for the most recent day with a burn (balance decreased)
  // We look back a few days to handle cases where the very last day might be a top-up
  const MAX_LOOKBACK = 3;

  for (let i = 0; i < Math.min(rows.length - 1, MAX_LOOKBACK); i++) {
    const current = Number(rows[i].balance_dc);
    const prev = Number(rows[i + 1].balance_dc);

    if (!Number.isFinite(current) || !Number.isFinite(prev)) continue;

    const diff = prev - current;
    if (diff > 0) {
      return diff; // Found the most recent burn
    }
  }

  return 0; // No burn found in lookback period
}

export function pickThreshold(daysRemaining, lastNotifiedLevel) {
  if (daysRemaining <= 1 && lastNotifiedLevel < 1) return 1;
  if (daysRemaining <= 7 && lastNotifiedLevel < 7) return 7;
  if (daysRemaining <= 14 && lastNotifiedLevel < 14) return 14;
  return null;
}
