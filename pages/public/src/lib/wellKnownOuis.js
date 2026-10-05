import { dedupeAsync } from "./requestDedupe.js";

// Helium's curated OUI directory (`helium/well-known` lists/ouis.json) — the
// only public source of human names for OUIs (the IoT utilization API is
// numeric ids only, by design). raw.githubusercontent.com is CORS-open and
// this site sets no connect-src CSP, so the browser fetches it directly (~5 KB).
// Ported from World Explorer's `lib/iot-utilization/well-known-ouis.ts` so the
// two sites label operators the same way.
const WELL_KNOWN_OUIS_URL =
  "https://raw.githubusercontent.com/helium/well-known/refs/heads/main/lists/ouis.json";

/** Where an operator submits their OUI's name (a PR to `lists/ouis.json`). */
export const WELL_KNOWN_REPO_URL = "https://github.com/helium/well-known";

/**
 * Raw directory → `{ id, name }` pairs. A non-array yields `[]`; malformed
 * entries are skipped rather than failing the list; null ids (Mobile
 * escrows) are dropped; a repeated id keeps its FIRST entry.
 */
function normalizeWellKnownOuis(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const id = entry?.id;
    const name = typeof entry?.name === "string" ? entry.name.trim() : "";
    if (!Number.isInteger(id) || id < 0 || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

async function requestWellKnownOuiNames() {
  // raw.githubusercontent.com serves text/plain, so not api.js's parseJson.
  const res = await fetch(WELL_KNOWN_OUIS_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`well-known OUI fetch failed: ${res.status}`);
  const list = normalizeWellKnownOuis(await res.json());
  if (list.length === 0) throw new Error("well-known OUI list is empty");
  return new Map(list.map(({ id, name }) => [id, name]));
}

/**
 * OUI id → organisation name, fetched once per session. Rejects on failure
 * (never cached, so a later call retries) so callers can tell "the list
 * didn't load" from "this OUI isn't listed" — on failure every OUI reads
 * "OUI {id}" and nothing should claim it's unlisted.
 */
export const fetchWellKnownOuiNames = dedupeAsync(requestWellKnownOuiNames, Infinity);

// Longest first where one suffix contains another (" LoRaWAN Console" before
// " Console", " Ltd." before " Ltd"); only one is ever stripped.
const NAME_SUFFIXES = [" LoRaWAN Console", " Console", " Ltd.", " Ltd", " Limited", " Inc.", " Inc", " LLC"];
const PUBLIC_SUFFIXES = [".co.uk", ".com", ".io", ".xyz", ".net", ".org"];

/**
 * A compact form of a well-known name: drops one corporate/"Console" suffix,
 * and reduces a domain-like single token to its distinctive label
 * ("helium.dataMatters.io" → "dataMatters"). Falls back to the original name
 * when the result would be shorter than two characters.
 */
function shortOuiName(name) {
  let short = name.trim();
  const lower = short.toLowerCase();
  const suffix = NAME_SUFFIXES.find((s) => lower.endsWith(s.toLowerCase()));
  if (suffix) short = short.slice(0, -suffix.length).trim();

  if (!/\s/.test(short) && short.includes(".")) {
    const shortLower = short.toLowerCase();
    const publicSuffix = PUBLIC_SUFFIXES.find((s) => shortLower.endsWith(s));
    // An unrecognised suffix is left alone: keeping the "last label" there
    // would reduce the name to its TLD.
    if (publicSuffix) {
      const labels = short.slice(0, -publicSuffix.length).split(".").filter(Boolean);
      short = labels.at(-1) ?? "";
    }
  }

  short = short.trim();
  return short.length < 2 ? name : short;
}

/**
 * Label a list of OUI ids (order preserved). `duplicate` marks a short name
 * another OUI in the SAME list shares (e.g. LoneStar Tracking is listed as
 * both 12 and 492), so the caller must show the id too.
 *
 * @returns {{oui:number, fullName:string|null, shortName:string|null, duplicate:boolean}[]}
 */
export function labelOuis(ouis, names) {
  const labeled = ouis.map((oui) => {
    const fullName = names?.get(oui) ?? null;
    return { oui, fullName, shortName: fullName === null ? null : shortOuiName(fullName) };
  });
  const counts = new Map();
  for (const { shortName } of labeled) {
    if (shortName !== null) counts.set(shortName, (counts.get(shortName) ?? 0) + 1);
  }
  return labeled.map((item) => ({
    ...item,
    duplicate: item.shortName !== null && (counts.get(item.shortName) ?? 0) > 1,
  }));
}
