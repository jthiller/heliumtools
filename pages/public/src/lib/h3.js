import { cellToLatLng } from "h3-js";

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
