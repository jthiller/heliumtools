// Off-chain proposal body fetcher. A proposal's `uri` points to free-form
// markdown/text describing it (heliumvote renders it as markdown). We fetch it
// best-effort, cap the size, and cache it for a long time since it rarely
// changes — failures degrade gracefully to null.

import { MAX_CONTENT_CHARS, CONTENT_CACHE_TTL } from "../config.js";

export async function getProposalContent(env, proposalId, uri) {
  if (!uri) return null;

  const cacheKey = `vote:content:${proposalId}`;
  if (env.KV) {
    const cached = await env.KV.get(cacheKey, "json");
    if (cached) return cached;
  }

  let result = null;
  try {
    const httpsUri = uri.replace(/^http:\/\//, "https://");
    const res = await fetch(httpsUri, { signal: AbortSignal.timeout(6_000) });
    if (res.ok) {
      const raw = await res.text();
      const truncated = raw.length > MAX_CONTENT_CHARS;
      result = { text: raw.slice(0, MAX_CONTENT_CHARS), truncated, source: httpsUri };
    }
  } catch {
    result = null;
  }

  if (result && env.KV) {
    await env.KV.put(cacheKey, JSON.stringify(result), {
      expirationTtl: CONTENT_CACHE_TTL,
    });
  }
  return result;
}
