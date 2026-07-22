/**
 * Vendor guides + AP configuration constants for converted WiFi networks.
 * Sources: docs.helium.com/mobile/wifi-conversion-onboarding and the
 * per-vendor guides it links (docs.helium.com/mobile/helium-plus-<slug>).
 */

const DOCS_BASE = "https://docs.helium.com/mobile";

export const VENDORS = [
  { name: "Aruba", slug: "aruba" },
  { name: "Aruba Central", slug: "aruba-central" },
  { name: "Cambium cnMaestro", slug: "cambium-cnmaestro" },
  { name: "Cisco Meraki", slug: "meraki" },
  { name: "Extreme", slug: "extreme" },
  { name: "Fortinet", slug: "fortinet" },
  { name: "Juniper Mist", slug: "juniper-mist" },
  { name: "MikroTik", slug: "mikrotik" },
  { name: "Ruckus", slug: "ruckus" },
  { name: "Ubiquiti", slug: "ubiquiti" },
].map((v) => ({ ...v, url: `${DOCS_BASE}/helium-plus-${v.slug}` }));

export const EXTRA_GUIDES = [
  { name: "General conversion guide", url: `${DOCS_BASE}/helium-plus-generic`, description: "Vendor-agnostic Passpoint + RadSec setup" },
  { name: "RadSecProxy", url: `${DOCS_BASE}/helium-plus-radsecproxy`, description: "For gear that speaks RADIUS but not RadSec" },
  { name: "Security FAQ", url: `${DOCS_BASE}/helium-plus-security-faq`, description: "What the certificates can and cannot do" },
];

// RADIUS-over-TLS servers the AP connects to (TCP). Same three for auth and
// accounting; interim accounting updates every 300 seconds.
export const RADSEC_SERVERS = [
  "52.37.147.195:2083",
  "44.229.62.214:2083",
  "44.241.107.197:2083",
];
export const RADSEC_SHARED_SECRET = "radsec";

// Passpoint config to add for each carrier you want to serve. Every realm uses
// EAP-TLS with a Certificate sub-method. Helium Mobile / Noble Mobile needs
// both of its realms. Some carriers also need a Passpoint Domain value
// (`domain`): Helium Mobile uses freedomfi.com as a domain, and Google Fi runs
// on Google's Orion Wifi (orionwifi.com). A `domain` equal to the realm is
// intentional (the same string is both the NAI realm and a domain entry).
export const NAI_REALMS = [
  { realm: "freedomfi.com", carrier: "Helium Mobile / Noble Mobile", domain: "freedomfi.com" },
  { realm: "hellohelium.com", carrier: "Helium Mobile / Noble Mobile" },
  { realm: "premnet.wefi.com", carrier: "WeFi" },
  { realm: "wifi.fi.google.com", carrier: "Google Fi", domain: "orionwifi.com" },
];

export const AP_CONSTANTS = [
  { label: "Security", value: "WPA3-Enterprise (802.1X/EAP)" },
  { label: "Venue type", value: "Chargeable Public Network" },
  { label: "IPv4 availability", value: "Double NATed private IPv4" },
  { label: "IPv6 availability", value: "Unavailable" },
  { label: "Interim accounting", value: "300 seconds" },
];

// Carriers a self-serve converted network serves the moment it's onboarded here.
export const SELF_SERVE_CARRIERS = ["Helium Mobile / Noble Mobile", "Google Fi", "WeFi"];
// Larger carriers enabled later, on the same deployment, through the Helium
// Plus enterprise program. This tool is the self-serve on-ramp to it, not a gate.
export const PARTNER_CARRIERS = { names: ["T-Mobile", "AT&T", "Telefonica"], url: "https://helium.plus" };
