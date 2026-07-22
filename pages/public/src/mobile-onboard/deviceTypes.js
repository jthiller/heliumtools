/**
 * Mobile device-type helpers for the Manage surface.
 *
 * Only "brownfield" converted WiFi networks (on-chain device_type
 * `wifiDataOnly`) have retrievable RadSec certificates — the cert service is
 * literally the brownfield inventory. Helium Indoor / Outdoor
 * (`wifiIndoor` / `wifiOutdoor`, the greenfield Helium Mobile hardware), CBRS
 * radios, and IoT Hotspots have no keys to retrieve. This tool centers on
 * brownfield networks and downplays the rest.
 */
export function isBrownfield(deviceType) {
  return deviceType === "wifiDataOnly";
}

export function mobileDeviceLabel(deviceType) {
  switch (deviceType) {
    case "wifiDataOnly": return "Converted WiFi";
    case "wifiIndoor": return "Helium Indoor";
    case "wifiOutdoor": return "Helium Outdoor";
    case "cbrs": return "CBRS";
    default: return "Mobile";
  }
}
