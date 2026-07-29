/**
 * Short-lived capability artifacts for the "Configure with AI" agent brief.
 *
 * An artifact is a blob (markdown brief, or a certificate bundle) reachable at
 * an unguessable URL for a bounded time. The id IS the capability — there is no
 * other authorization on the GET — so ids are 192 bits of CSPRNG and are never
 * logged in full.
 *
 * PRIVACY: the `certs` kind holds the network's RadSec PRIVATE KEY. Never log
 * payloads, and never widen the read path beyond the id + expiry check below.
 * This is the one deliberate exception to the tool's otherwise
 * nothing-is-persisted posture (see handlers/cert.js and CLAUDE.md).
 */

const MAX_PAYLOAD_BYTES = 256 * 1024;

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady || !env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS agent_artifacts (
       id TEXT PRIMARY KEY,
       kind TEXT NOT NULL,
       hotspot TEXT NOT NULL,
       content_type TEXT NOT NULL,
       payload TEXT NOT NULL,
       one_time INTEGER NOT NULL DEFAULT 0,
       expires_at INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  ).run();
  // expires_at drives the cron purge; hotspot drives regenerate-invalidation.
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_agent_artifacts_expires ON agent_artifacts (expires_at)`,
  ).run();
  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_agent_artifacts_hotspot ON agent_artifacts (hotspot)`,
  ).run();
  schemaReady = true;
}

/** 192-bit unguessable, URL-safe id. */
export function randomArtifactId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Access-event log: enough for forensics ("was this link ever fetched?"),
 * never enough to reconstruct a capability. Only an 8-char id prefix is
 * recorded — a live brief id must not be reconstructable from logs.
 */
function logEvent(action, { id, kind, hotspot }) {
  console.log(
    `agent-artifact ${action}`,
    JSON.stringify({ id: String(id).slice(0, 8), kind, hotspot }),
  );
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Store an artifact. Returns { id, expiresAt } (expiresAt in epoch seconds).
 */
export async function putArtifact(env, { kind, hotspot, contentType, payload, oneTime = false, ttlSeconds }) {
  if (!env.DB) throw new Error("D1 binding unavailable");
  if (typeof payload !== "string" || payload.length === 0) {
    throw new Error("Artifact payload must be a non-empty string");
  }
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new Error("Artifact payload too large");
  }
  await ensureSchema(env);

  const id = randomArtifactId();
  const created = nowSeconds();
  const expiresAt = created + ttlSeconds;

  await env.DB.prepare(
    `INSERT INTO agent_artifacts (id, kind, hotspot, content_type, payload, one_time, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(id, kind, hotspot, contentType, payload, oneTime ? 1 : 0, expiresAt, created)
    .run();

  logEvent("created", { id, kind, hotspot });
  return { id, expiresAt };
}

/**
 * Read an artifact by id and kind, consuming it if it is single-use.
 * Returns { payload, contentType, kind, hotspot } or null when missing,
 * expired, of the wrong kind, or already consumed — callers must not
 * distinguish those cases to the client beyond the shared 410.
 *
 * The single-use path is one atomic statement (`DELETE ... RETURNING`) so two
 * concurrent fetches cannot both receive the payload. Expiry is enforced in
 * the WHERE clause, so a logically-expired row that the cron has not purged
 * yet is never served.
 */
export async function consumeArtifact(env, id, expectedKind) {
  if (!env.DB || typeof id !== "string" || !id || !expectedKind) return null;
  await ensureSchema(env);
  const now = nowSeconds();

  // Single-use: atomically claim it. Exactly one concurrent caller wins.
  // `kind` is matched in the statement, not after the read — checking it
  // afterwards would let a request to the wrong route consume (and destroy) a
  // single-use artifact without ever delivering it.
  const claimed = await env.DB.prepare(
    `DELETE FROM agent_artifacts
      WHERE id = ?1 AND expires_at > ?2 AND one_time = 1 AND kind = ?3
      RETURNING payload, content_type, kind, hotspot`,
  )
    .bind(id, now, expectedKind)
    .first();

  if (claimed) {
    logEvent("consumed", { id, kind: claimed.kind, hotspot: claimed.hotspot });
    return {
      payload: claimed.payload,
      contentType: claimed.content_type,
      kind: claimed.kind,
      hotspot: claimed.hotspot,
    };
  }

  // Re-readable (the brief): serve without consuming.
  const row = await env.DB.prepare(
    `SELECT payload, content_type, kind, hotspot
       FROM agent_artifacts
      WHERE id = ?1 AND expires_at > ?2 AND one_time = 0 AND kind = ?3`,
  )
    .bind(id, now, expectedKind)
    .first();

  if (!row) return null;
  logEvent("served", { id, kind: row.kind, hotspot: row.hotspot });
  return {
    payload: row.payload,
    contentType: row.content_type,
    kind: row.kind,
    hotspot: row.hotspot,
  };
}

/**
 * Drop every artifact for a Hotspot. Called before minting a new set so
 * "Regenerate" genuinely invalidates the links the operator (or an agent) may
 * still be holding.
 */
export async function invalidateHotspotArtifacts(env, hotspot) {
  if (!env.DB || !hotspot) return 0;
  await ensureSchema(env);
  const res = await env.DB.prepare(`DELETE FROM agent_artifacts WHERE hotspot = ?1`)
    .bind(hotspot)
    .run();
  const count = res?.meta?.changes ?? 0;
  if (count > 0) logEvent("invalidated", { id: "-", kind: `x${count}`, hotspot });
  return count;
}

/** Cron: drop expired rows so spent/stale key material doesn't linger. */
export async function purgeExpiredArtifacts(env) {
  if (!env.DB) return 0;
  try {
    await ensureSchema(env);
    const res = await env.DB.prepare(`DELETE FROM agent_artifacts WHERE expires_at <= ?1`)
      .bind(nowSeconds())
      .run();
    const count = res?.meta?.changes ?? 0;
    if (count > 0) console.log(`agent-artifact purge removed ${count} expired row(s)`);
    return count;
  } catch (err) {
    console.error("agent-artifact purge failed:", err.message);
    return 0;
  }
}
