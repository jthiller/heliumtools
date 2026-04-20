import { corsHeaders } from "../../../lib/response.js";

// Response is derived from the requester's IP — must not be cached by any
// intermediary, or users could be served each other's coarse location.
export function handleGeo(request) {
  const cf = request.cf || {};
  const lat = cf.latitude != null ? parseFloat(cf.latitude) : NaN;
  const lng = cf.longitude != null ? parseFloat(cf.longitude) : NaN;
  const body = Number.isFinite(lat) && Number.isFinite(lng)
    ? { latitude: lat, longitude: lng, city: cf.city ?? null }
    : { latitude: null, longitude: null, city: null };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}
