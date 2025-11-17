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

export function computeAvgDailyBurn(rows) {
  if (!rows || rows.length < 2) return 0;
  let totalBurn = 0;
  let days = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const current = Number(rows[i].balance_dc);
    const prev = Number(rows[i + 1].balance_dc);
    if (!Number.isFinite(current) || !Number.isFinite(prev)) continue;
    const diff = prev - current;
    if (diff > 0) totalBurn += diff;
    days++;
  }
  if (days === 0) return 0;
  return totalBurn / days;
}

export function pickThreshold(daysRemaining, lastNotifiedLevel) {
  if (daysRemaining <= 1 && lastNotifiedLevel < 1) return 1;
  if (daysRemaining <= 7 && lastNotifiedLevel < 7) return 7;
  if (daysRemaining <= 14 && lastNotifiedLevel < 14) return 14;
  return null;
}
