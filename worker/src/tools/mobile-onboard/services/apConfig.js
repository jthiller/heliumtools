/**
 * Access-point configuration constants for the agent brief.
 *
 * ⚠ MUST STAY IN SYNC with `pages/public/src/mobile-onboard/vendors.js`, which
 * renders the same values in the AP Setup Guide UI. The two deployables can't
 * share a module (separate packages/builds), so this is a deliberate duplicate:
 * if an operator sees one set of realms in the guide and an agent is handed
 * another, they get contradictory instructions. Change both or neither.
 */

const DOCS_BASE = "https://docs.helium.com/mobile";

/**
 * `surface` is a hint about the most likely execution path, not a capability
 * assertion — several of these platforms have APIs we don't want to claim
 * specifics about. "gui" means the controller is primarily a web console, so
 * browser control is usually needed (certificate install in particular is a
 * file-upload dialog on these).
 */
export const VENDORS = [
  { name: "Aruba", slug: "aruba", surface: "cli" },
  { name: "Aruba Central", slug: "aruba-central", surface: "gui" },
  { name: "Cambium cnMaestro", slug: "cambium-cnmaestro", surface: "gui" },
  { name: "Cisco Meraki", slug: "meraki", surface: "gui" },
  { name: "Extreme", slug: "extreme", surface: "gui" },
  { name: "Fortinet", slug: "fortinet", surface: "cli" },
  { name: "Juniper Mist", slug: "juniper-mist", surface: "gui" },
  { name: "MikroTik", slug: "mikrotik", surface: "cli" },
  { name: "Ruckus", slug: "ruckus", surface: "gui" },
  { name: "Ubiquiti", slug: "ubiquiti", surface: "gui" },
].map((v) => ({ ...v, docUrl: `${DOCS_BASE}/helium-plus-${v.slug}.md` }));

export function findVendor(slug) {
  return VENDORS.find((v) => v.slug === slug) || null;
}

export const GENERIC_DOC_URL = `${DOCS_BASE}/helium-plus-generic.md`;
export const RADSECPROXY_DOC_URL = `${DOCS_BASE}/helium-plus-radsecproxy.md`;

export const RADSEC_SERVERS = [
  "52.37.147.195:2083",
  "44.229.62.214:2083",
  "44.241.107.197:2083",
];
export const RADSEC_SHARED_SECRET = "radsec";

/** Every realm uses EAP-TLS with a Certificate sub-method. */
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

export const SELF_SERVE_CARRIERS = ["Helium Mobile / Noble Mobile", "Google Fi", "WeFi"];
