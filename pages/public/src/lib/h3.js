import { cellToLatLng, latLngToCell } from "h3-js";

/**
 * Convert an H3 cell index (decimal string from on-chain u64) to [lat, lng].
 * Returns null if conversion fails.
 */
export function h3ToLatLng(h3Decimal) {
  try {
    const hex = BigInt(h3Decimal).toString(16);
    return cellToLatLng(hex);
  } catch {
    return null;
  }
}

/**
 * Convert a lat/lng pair (strings or numbers) to an H3 resolution-12 cell as
 * a hex string. Returns null when the inputs aren't finite coordinates.
 */
export function latLngToH3(lat, lng) {
  const la = parseFloat(lat);
  const lo = parseFloat(lng);
  if (isNaN(la) || isNaN(lo)) return null;
  try {
    return latLngToCell(la, lo, 12);
  } catch {
    return null;
  }
}
