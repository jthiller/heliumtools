/**
 * "Configure with AI" — mint and serve the agent brief.
 *
 * POST /agent-brief creates two short-lived capability artifacts: a markdown
 * brief (re-readable, 24h) and the RadSec certificate bundle (single-use, 2h).
 * The operator hands the brief URL to an LLM or coding agent.
 *
 * Ownership: the caller supplies the same wallet-signed payload the cert flow
 * uses, and a 2xx from Nova is the proof (Nova validates the signature against
 * the Hotspot). Anonymous callers therefore cannot write to our D1.
 *
 * PRIVACY: the `certs` artifact contains the RadSec PRIVATE KEY. This is the
 * tool's one deliberate persistence exception — short-lived, single-use,
 * behind an unguessable id, purged by cron. Never log payloads.
 */
import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import {
  validateSignedPayload,
  parseLocationData,
  isTimestampFresh,
  requestNovaCert,
  hasCertMaterial,
} from "../services/novaCert.js";
import {
  newArtifactId,
  artifactExpiry,
  replaceHotspotArtifacts,
  consumeArtifact,
} from "../services/artifacts.js";
import { renderBrief, renderExpiredNotice } from "../services/brief.js";
import { findVendor } from "../services/apConfig.js";
import { APP_MANAGE_URL } from "../config.js";

const SIGNATURE_MAX_AGE_SECONDS = 600;

/** Links are served by the worker; the manage/regenerate page is the app. */
function workerOrigin(request) {
  return new URL(request.url).origin;
}

function manageUrlFor(hotspot) {
  return hotspot ? `${APP_MANAGE_URL}?tab=manage&hotspot=${encodeURIComponent(hotspot)}` : `${APP_MANAGE_URL}?tab=manage`;
}

/**
 * POST /agent-brief
 * Body: { location_data, signature, vendor }
 */
export async function handleCreateAgentBrief(request, env) {
  const limited = await checkIpRateLimit(env, request, {
    prefix: "rl:mo:brief",
    maxRequests: 20,
    windowSeconds: 600,
  });
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { location_data, signature, vendor: vendorSlug } = body;

  const invalid = validateSignedPayload({ location_data, signature });
  if (invalid) return jsonResponse({ error: invalid }, 400);

  const vendor = findVendor(typeof vendorSlug === "string" ? vendorSlug : "");
  if (!vendor) return jsonResponse({ error: "Unknown or missing vendor" }, 400);

  // The Hotspot key comes from the *signed* payload, never a separate body
  // field that could disagree with what Nova validated.
  const location = parseLocationData(location_data);
  const hotspotKey = location?.blockchain_pubkey;
  if (!location || typeof hotspotKey !== "string" || !hotspotKey) {
    return jsonResponse({ error: "Invalid location_data payload" }, 400);
  }
  if (!isTimestampFresh(location.timestamp, SIGNATURE_MAX_AGE_SECONDS)) {
    return jsonResponse(
      { error: "Signed request has expired. Sign again to generate a link." },
      400,
    );
  }

  if (!env.DB) return jsonResponse({ error: "Storage unavailable" }, 503);

  // Fetch certs — this is also the ownership check.
  const result = await requestNovaCert({ location_data, signature });
  if (!result.ok) return jsonResponse({ error: result.error }, result.status);
  if (!hasCertMaterial(result.data)) {
    return jsonResponse({ error: "Unexpected certificate service response" }, 502);
  }

  // NAS ID and address come from the certificate record itself, so the brief's
  // "this must match your certificate exactly" claim is true by construction.
  const nasId = Array.isArray(result.data.nas_ids) ? result.data.nas_ids[0] : null;
  const address = result.data.location_address || "";

  // Ids are minted before the write so the brief can embed the cert's URL, and
  // both rows can then land in one batch: either the pair exists or neither
  // does, so a mid-write failure can't strand a live private key with no brief
  // to consume it.
  const certId = newArtifactId();
  const briefId = newArtifactId();
  const certExpiresAt = artifactExpiry("certs");
  const briefExpiresAt = artifactExpiry("brief");
  const origin = workerOrigin(request);
  const certUrl = `${origin}/mobile-onboard/agent-certs/${certId}`;

  try {
    // The brief carries no Hotspot name or key: the agent never enters either
    // one, so they were noise, and dropping the name removes the last piece of
    // unsigned client input we rendered into a document an agent follows.
    const markdown = renderBrief({
      vendor,
      nasId,
      address,
      certUrl,
      certExpiresAt,
      manageUrl: manageUrlFor(hotspotKey),
    });

    // Replacing (not appending) is what makes "Regenerate" genuinely invalidate
    // whatever the operator handed out before.
    await replaceHotspotArtifacts(env, hotspotKey, [
      {
        id: certId,
        kind: "certs",
        expiresAt: certExpiresAt,
        contentType: "application/json",
        payload: JSON.stringify({
          hotspot: hotspotKey,
          nas_id: nasId,
          location_address: address,
          radsec_private_key: result.data.radsec_private_key,
          radsec_certificate: result.data.radsec_certificate,
          radsec_ca_chain: result.data.radsec_ca_chain,
          radsec_cert_expire: result.data.radsec_cert_expire ?? null,
        }),
      },
      {
        id: briefId,
        kind: "brief",
        expiresAt: briefExpiresAt,
        contentType: "text/markdown; charset=utf-8",
        payload: markdown,
      },
    ]);

    return jsonResponse({
      briefUrl: `${origin}/mobile-onboard/agent-brief/${briefId}`,
      certUrl,
      briefExpiresAt,
      certExpiresAt,
      vendor: vendor.slug,
      nas_id: nasId,
    });
  } catch (err) {
    console.error("mobile-onboard agent-brief create error:", err.message);
    return jsonResponse({ error: "Could not create the agent link" }, 500);
  }
}

/**
 * Every artifact response, including the error bodies, is written for an agent
 * to read. A private key must never be cached by an intermediary or indexed, so
 * the no-store/noindex pair is unconditional.
 */
function artifactResponse(body, status, contentType = "text/markdown; charset=utf-8") {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/**
 * Serve an artifact. `expectedKind` keeps the two routes from serving each
 * other's ids. Missing / expired / already-consumed all collapse to the same
 * 410 with recovery instructions — the agent should never be able to tell
 * those apart, and should never be left guessing what to do next.
 */
export async function handleGetArtifact(env, id, expectedKind) {
  let found = null;
  try {
    // Kind is matched inside the query so a request to the wrong route can
    // never consume (and destroy) a single-use artifact.
    found = await consumeArtifact(env, id, expectedKind);
  } catch (err) {
    // A storage failure is not an expired link. Telling an agent "already used
    // or expired" here would send the operator off regenerating a link that
    // was never the problem.
    console.error("mobile-onboard artifact read error:", err.message);
    return artifactResponse(
      "# Temporary problem retrieving this link\n\nThis is a server-side error, not an expired link. Wait a moment and try the same URL again before asking the operator to regenerate anything.\n",
      503,
    );
  }

  return found
    ? artifactResponse(found.payload, 200, found.contentType)
    : artifactResponse(
        renderExpiredNotice({ kind: expectedKind, manageUrl: manageUrlFor(null) }),
        410,
      );
}
