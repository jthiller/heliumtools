import { parseJson } from "./api.js";

const API_BASE = import.meta.env.DEV
  ? "/api/shared"
  : "https://api.heliumtools.org/shared";

let geoPromise = null;
export function fetchGeo() {
  if (geoPromise) return geoPromise;
  const thisFetch = (async () => {
    try {
      const res = await fetch(`${API_BASE}/geo`);
      if (!res.ok) return null;
      const data = await parseJson(res);
      if (data?.latitude == null || data?.longitude == null) return null;
      return { latitude: data.latitude, longitude: data.longitude };
    } catch {
      return null;
    }
  })();
  geoPromise = thisFetch;
  // Don't memoize failure — identity check prevents clobbering a successful retry.
  thisFetch.then((result) => {
    if (result == null && geoPromise === thisFetch) geoPromise = null;
  });
  return thisFetch;
}
