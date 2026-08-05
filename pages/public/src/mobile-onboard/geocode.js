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

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/**
 * @param {string} query free-text street address
 * @returns {Promise<Array<{lat: number, lng: number, label: string, rank: number}>>}
 *   Up to 3 matches, best first. Empty array when nothing resolves.
 */
export async function geocodeAddress(query) {
  const q = query.trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, format: "jsonv2", limit: "3", addressdetails: "0" });
  const res = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { Accept: "application/json" },
    // A stalled request must fail into the caller's error path (which
    // re-enables the search button), not hang "Searching…" for minutes.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Address search failed (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .map((r) => ({
      // jsonv2 returns lat/lon as strings.
      lat: parseFloat(r.lat),
      lng: parseFloat(r.lon),
      label: typeof r.display_name === "string" ? r.display_name : "",
      rank: typeof r.place_rank === "number" ? r.place_rank : 0,
    }))
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
}

/**
 * Map Nominatim's place_rank to a viewport zoom that matches the match's
 * precision: a building-level hit deserves a rooftop view, a city-level hit
 * must NOT zoom to rooftops (the pin would land on an arbitrary block and look
 * authoritative). 30=building, 26-29=street/house, 16-25=suburb/city.
 */
export function zoomForRank(rank) {
  if (rank >= 28) return 18;
  if (rank >= 26) return 16.5;
  if (rank >= 16) return 13;
  return 11;
}
