// Nova/Helium Mobile certificate service ("brownfield inventory"). Issues and
// re-serves the RadSec client certificates for converted WiFi networks.
// Mirrors CERT_URL_MAINNET in helium-wallet-rs helium-lib/src/client.rs.
// The API sends no CORS headers, so the browser cannot call it directly —
// the worker proxies POST /cert to it verbatim.
export const CERT_API_BASE = "https://api.prod.ims.nova.xyz/api/wifi/brownfield/inventory";
export const CERT_API_PATH = "/v1/locations/residential";

// The public app page an agent points the operator back to when a capability
// link has expired (the worker lives on api.*, the tool lives on the app).
// Not derived from APP_BASE_URL, which is oui-notifier specific.
export const APP_MANAGE_URL = "https://heliumtools.org/mobile-onboard";
