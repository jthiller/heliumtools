// Off-chain proposal body fetcher. A proposal's `uri` points to free-form
// markdown/text describing it (heliumvote renders it as markdown). It is
// attacker-influenceable — anyone can create a proposal account with an
// arbitrary uri and pass that proposal's id to /vote/proposal — so we treat it
// as untrusted: https only, no IP-literal / localhost / internal targets
// (SSRF), and a hard streamed byte cap so a huge response can't exhaust memory.
// Everything is best-effort: any failure degrades to null and is cached long
// since the body rarely changes.

import { MAX_CONTENT_BYTES, MAX_CONTENT_CHARS, CONTENT_CACHE_TTL } from "../config.js";
import { kvGetJson, kvPutJson } from "../../../lib/kv.js";

/**
 * Validate an untrusted uri for outbound fetch. Returns a safe https URL string
 * or null. Rejects non-https, raw IPv4/IPv6 literals, and localhost/internal
 * hostnames — governance bodies live on public domains, not raw IPs.
 */
function safeContentUrl(uri) {
  let u;
  try {
    u = new URL(uri.replace(/^http:\/\//i, "https://"));
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return null;
  }
  // IPv6 literals are bracketed; reject any literal-IP host outright.
  if (u.hostname.startsWith("[") || host.includes(":")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return u.toString();
}

/** Read up to maxBytes from a Response body, then cancel the stream. */
async function readCapped(res, maxBytes) {
  if (!res.body) {
    const raw = await res.text();
    return Buffer.from(raw, "utf8").slice(0, maxBytes);
  }
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).slice(0, maxBytes);
}

export async function getProposalContent(env, proposalId, uri) {
  if (!uri) return null;

  const cacheKey = `vote:content:${proposalId}`;
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return cached;

  let result = null;
  try {
    const safeUri = safeContentUrl(uri);
    if (safeUri) {
      const res = await fetch(safeUri, {
        signal: AbortSignal.timeout(6_000),
        redirect: "follow",
      });
      const len = Number(res.headers.get("content-length"));
      if (res.ok && (!Number.isFinite(len) || len <= MAX_CONTENT_BYTES * 8)) {
        const buf = await readCapped(res, MAX_CONTENT_BYTES);
        const raw = buf.toString("utf8");
        result = {
          text: raw.slice(0, MAX_CONTENT_CHARS),
          truncated: buf.length >= MAX_CONTENT_BYTES || raw.length > MAX_CONTENT_CHARS,
          source: safeUri,
        };
      }
    }
  } catch {
    result = null;
  }

  if (result) await kvPutJson(env, cacheKey, result, CONTENT_CACHE_TTL);
  return result;
}
