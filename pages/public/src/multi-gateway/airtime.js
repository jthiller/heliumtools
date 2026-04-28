// LoRa airtime, per Semtech AN1200.13. Mirrors avbentem/airtime-calculator.
// Helium isn't subject to the duty-cycle ceilings that calculator surfaces;
// this is purely visualization.

const SPREADING_FACTOR_RE = /^SF(\d+)BW(\d+)$/i;

// Parses Helium's `spreading_factor` field (e.g. "SF10BW125") into SF + BW
// (kHz). Returns null on unrecognized input so callers can pick their own
// fallback rather than silently defaulting to a wrong rate.
export function parseSpreadingFactor(s) {
  if (typeof s !== "string") return null;
  const m = SPREADING_FACTOR_RE.exec(s.trim());
  if (!m) return null;
  const sf = Number(m[1]);
  const bw = Number(m[2]);
  if (!Number.isFinite(sf) || !Number.isFinite(bw)) return null;
  return { sf, bw };
}

// Time on air in ms. LoRaWAN defaults: CR=4/5, preamble=8, explicit header,
// CRC on. Low-data-rate-optimize auto-enables for SF>=11 @ BW=125 (the
// Tsym > 16ms rule).
export function loraAirtimeMs(sf, bw, payloadBytes, opts = {}) {
  if (!Number.isFinite(sf) || !Number.isFinite(bw) || !Number.isFinite(payloadBytes)) return 0;
  if (sf < 6 || sf > 12 || bw <= 0 || payloadBytes < 0) return 0;

  const cr = opts.cr ?? 1;
  const preambleSymbols = opts.preambleSymbols ?? 8;
  const crcOn = opts.crcOn !== false;
  const explicitHeader = opts.explicitHeader !== false;
  const lowDataRateOptimize = opts.lowDataRateOptimize ?? "auto";

  const tSym = (2 ** sf) / (bw * 1000);
  const de = lowDataRateOptimize === "auto"
    ? (tSym > 0.016 ? 1 : 0)
    : (lowDataRateOptimize ? 1 : 0);
  const h = explicitHeader ? 0 : 1;
  const crc = crcOn ? 1 : 0;
  const numerator = 8 * payloadBytes - 4 * sf + 28 + 16 * crc - 20 * h;
  const denom = 4 * (sf - 2 * de);
  const payloadSymb = 8 + Math.max(Math.ceil(numerator / denom) * (cr + 4), 0);
  const tPreamble = (preambleSymbols + 4.25) * tSym;
  const tPayload = payloadSymb * tSym;
  return (tPreamble + tPayload) * 1000;
}
