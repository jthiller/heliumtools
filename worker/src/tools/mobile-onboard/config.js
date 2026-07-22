// Nova/Helium Mobile certificate service ("brownfield inventory"). Issues and
// re-serves the RadSec client certificates for converted WiFi networks.
// Mirrors CERT_URL_MAINNET in helium-wallet-rs helium-lib/src/client.rs.
// The API sends no CORS headers, so the browser cannot call it directly —
// the worker proxies POST /cert to it verbatim.
export const CERT_API_BASE = "https://api.prod.ims.nova.xyz/api/wifi/brownfield/inventory";
export const CERT_API_PATH = "/v1/locations/residential";
