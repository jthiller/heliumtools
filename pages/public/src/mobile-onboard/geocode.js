/**
 * Address → coordinates via OpenStreetMap Nominatim, called DIRECTLY from the
 * browser — deliberately not proxied through the worker:
 *
 *  - Nominatim throttles/blocks shared cloud egress IPs, and a worker proxy
 *    would funnel every user through Cloudflare's (the same reason
 *    wallet-dashboard avoids CoinGecko). Browser-direct rides each user's own
 *    IP, trivially inside the 1 req/s policy limit.
 *  - CORS is open (`Access-Control-Allow-Origin: *`) and there is no secret,
 *    so the proxy would add nothing but a failure mode.
 *  - The browser's Referer identifies the application, which is what
 *    Nominatim's usage policy asks of clients that can't set a User-Agent.
 *
 * Policy constraints honored by the callers: lookups fire only on an explicit
 * user action (button/Enter), never as autocomplete-per-keystroke, and results
 * are attributed to OpenStreetMap in the UI.
 */
import { parseJson } from "../lib/api.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/**
 * Map Nominatim's place_rank to a viewport zoom that matches the match's
 * precision: a building-level hit deserves a rooftop view, a city-level hit
 * must NOT zoom to rooftops (the pin would land on an arbitrary block and look
 * authoritative). 28-30=address/building, 26-27=street, 16-25=suburb/city.
 */
function zoomForRank(rank) {
  if (rank >= 28) return 18;
  if (rank >= 26) return 16.5;
  if (rank >= 16) return 13;
  return 11;
}

/**
 * @param {string} query free-text street address
 * @returns {Promise<{lat: number, lng: number, label: string, zoom: number} | null>}
 *   The best match with a precision-appropriate viewport zoom, or null when
 *   nothing resolves.
 */
export async function geocodeAddress(query) {
  const q = query.trim();
  if (q.length < 3) return null;
  const params = new URLSearchParams({ q, format: "jsonv2", limit: "1" });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { Accept: "application/json" },
    // A stalled request must fail into the caller's error path (which
    // re-enables the search button), not hang "Searching…" for minutes.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const data = await parseJson(res);
  const top = Array.isArray(data) ? data[0] : null;
  if (!top) return null;
  // jsonv2 returns lat/lon as strings.
  const lat = parseFloat(top.lat);
  const lng = parseFloat(top.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    label: typeof top.display_name === "string" ? top.display_name : "",
    zoom: zoomForRank(typeof top.place_rank === "number" ? top.place_rank : 0),
  };
}
