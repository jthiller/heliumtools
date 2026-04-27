/**
 * Resolve the upstream Rust LNS host. Override via the
 * MULTI_GATEWAY_HOST env var; falls back to the production hostname.
 */
export function getHost(env) {
  return env.MULTI_GATEWAY_HOST || "hotspot.heliumtools.org";
}
