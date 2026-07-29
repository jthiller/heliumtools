/**
 * Short-lived capability artifacts for the "Configure with AI" agent brief.
 *
 * An artifact is a blob (markdown brief, or a certificate bundle) reachable at
 * an unguessable URL for a bounded time. The id IS the capability — there is no
 * other authorization on the GET — so ids are 192 bits of CSPRNG. They are kept
 * out of *our* application logs (see logEvent), but they do appear in
 * Cloudflare's invocation logs because they ride in the URL path.
 *
 * PRIVACY: the `certs` kind holds the network's RadSec PRIVATE KEY. Never log
 * payloads, and never widen the read path beyond the id + kind + expiry check
 * below. This is the one deliberate exception to the tool's otherwise
 * nothing-is-persisted posture (see handlers/cert.js and CLAUDE.md).
 */

const TABLE = "mobile_onboard_artifacts";
const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * The two kinds and their lifetimes. `oneTime` and `kind` are not independent —
 * keeping the pair here means the mint and read paths can't disagree about
 * whether something is single-use.
 */
export const ARTIFACT_KINDS = {
  brief: { oneTime: false, ttlSeconds: 24 * 60 * 60 }, // re-readable across an install day
  certs: { oneTime: true, ttlSeconds: 2 * 60 * 60 },   // covers a realistic staged session
};

// Memoized promise, not a boolean: concurrent callers in a cold isolate would
// otherwise each run the full DDL before the flag flipped.
let schemaPromise = null;

function ensureSchema(env) {
  if (!env.DB) return Promise.resolve();
  schemaPromise ??= env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (
         id TEXT PRIMARY KEY,
         kind TEXT NOT NULL,
         hotspot TEXT NOT NULL,
         content_type TEXT NOT NULL,
         payload TEXT NOT NULL,
         one_time INTEGER NOT NULL DEFAULT 0,
         expires_at INTEGER NOT NULL,
         created_at INTEGER NOT NULL
       )`,
    ),
    // expires_at drives the cron purge; hotspot drives regenerate-invalidation.
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_expires ON ${TABLE} (expires_at)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_hotspot ON ${TABLE} (hotspot)`),
  ]).catch((err) => {
    schemaPromise = null; // let a transient failure be retried
    throw err;
  });
  return schemaPromise;
}

/** 192-bit unguessable, URL-safe id. Minted before the write so a payload can embed a sibling's URL. */
export function newArtifactId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Access-event log: an 8-char id prefix only, so these lines alone can't
 * reconstruct a capability.
 *
 * CAVEAT (do not claim otherwise): the id travels in the URL path, and this
 * Worker runs with `observability.logs` + `invocation_logs` enabled, so
 * Cloudflare's own invocation logs — and `wrangler tail` — record the FULL
 * request URL. Anyone with Workers Observability read access, a Logpush sink,
 * or a tail session can therefore see live ids. Workers Logs is an accepted
 * retention surface for this feature, listed with the others in CLAUDE.md.
 */
function logEvent(action, { id, kind, hotspot }) {
  console.log(
    `agent-artifact ${action}`,
    JSON.stringify({ id: String(id).slice(0, 8), kind, hotspot }),
  );
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

const toResult = (row) => ({
  payload: row.payload,
  contentType: row.content_type,
  kind: row.kind,
  hotspot: row.hotspot,
});

/** Wall-clock expiry for a kind. Callers compute it up front so the value they
 *  render into a payload is the same one they store. */
export const artifactExpiry = (kind) => nowSeconds() + ARTIFACT_KINDS[kind].ttlSeconds;

/**
 * Replace a Hotspot's artifacts with a new set, in a single transaction.
 *
 * Batched rather than issued statement-by-statement so a failure part-way
 * cannot leave a live private key stranded with no consumer — either the whole
 * set lands or none of it does, and no compensating cleanup is needed. Deleting
 * first is what makes "Regenerate" genuinely revoke the links the operator (or
 * an agent) may still be holding.
 *
 * @param {Array<{id,kind,contentType,payload,expiresAt}>} entries
 */
export async function replaceHotspotArtifacts(env, hotspot, entries) {
  if (!env.DB) throw new Error("D1 binding unavailable");
  if (!hotspot) throw new Error("Missing hotspot");
  await ensureSchema(env);

  const created = nowSeconds();
  for (const e of entries) {
    if (!ARTIFACT_KINDS[e.kind]) throw new Error(`Unknown artifact kind: ${e.kind}`);
    if (typeof e.payload !== "string" || !e.payload) {
      throw new Error("Artifact payload must be a non-empty string");
    }
    if (e.payload.length > MAX_PAYLOAD_BYTES) throw new Error("Artifact payload too large");
  }

  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${TABLE} WHERE hotspot = ?1`).bind(hotspot),
    ...entries.map((e) =>
      env.DB.prepare(
        `INSERT INTO ${TABLE} (id, kind, hotspot, content_type, payload, one_time, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        e.id,
        e.kind,
        hotspot,
        e.contentType,
        e.payload,
        ARTIFACT_KINDS[e.kind].oneTime ? 1 : 0,
        e.expiresAt,
        created,
      ),
    ),
  ]);

  for (const e of entries) logEvent("created", { id: e.id, kind: e.kind, hotspot });
}

/**
 * Read an artifact by id and kind, consuming it if that kind is single-use.
 * Returns null when missing, expired, of the wrong kind, or already consumed —
 * callers must not distinguish those cases to the client beyond the shared 410.
 *
 * One statement either way. The single-use path is an atomic
 * `DELETE … RETURNING`, so two concurrent fetches cannot both receive the
 * payload; `kind` is matched *inside* the statement, because checking it after
 * the read let a request to the wrong route consume (and destroy) a single-use
 * artifact without delivering it. Expiry is enforced in the WHERE, so a
 * logically-expired row the cron hasn't purged yet is never served.
 */
export async function consumeArtifact(env, id, expectedKind) {
  const spec = ARTIFACT_KINDS[expectedKind];
  if (!env.DB || typeof id !== "string" || !id || !spec) return null;
  await ensureSchema(env);
  const now = nowSeconds();

  const sql = spec.oneTime
    ? `DELETE FROM ${TABLE}
        WHERE id = ?1 AND expires_at > ?2 AND kind = ?3 AND one_time = 1
        RETURNING payload, content_type, kind, hotspot`
    : `SELECT payload, content_type, kind, hotspot FROM ${TABLE}
        WHERE id = ?1 AND expires_at > ?2 AND kind = ?3 AND one_time = 0`;

  const row = await env.DB.prepare(sql).bind(id, now, expectedKind).first();
  if (!row) return null;

  logEvent(spec.oneTime ? "consumed" : "served", { id, kind: row.kind, hotspot: row.hotspot });
  return toResult(row);
}

/** Cron: drop expired rows so spent/stale key material doesn't linger. */
export async function purgeExpiredArtifacts(env) {
  if (!env.DB) return 0;
  try {
    await ensureSchema(env);
    const res = await env.DB.prepare(`DELETE FROM ${TABLE} WHERE expires_at <= ?1`)
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
