import { jsonResponse } from "../../../lib/response.js";

export function handleGeo(request) {
  const cf = request.cf || {};
  const lat = cf.latitude != null ? parseFloat(cf.latitude) : NaN;
  const lng = cf.longitude != null ? parseFloat(cf.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return jsonResponse({ latitude: null, longitude: null });
  }
  return jsonResponse({ latitude: lat, longitude: lng, city: cf.city ?? null });
}
