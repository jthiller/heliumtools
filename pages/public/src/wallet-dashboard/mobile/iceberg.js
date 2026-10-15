// Helium's public Mobile Iceberg tables, read directly: table heads from the
// REST catalog, scan planning from the (immutable) manifest list and
// manifests, and one data file's rows through icebird's reader. Both the
// catalog and the bucket are anonymous and CORS-open.
import { parseIcebergJson } from "icebird/src/json.js";
import { fetchManifestEntries, icebergManifestList } from "icebird/src/manifest.js";
import { fileMightMatch, manifestMightMatch, partitionMightMatch } from "icebird/src/prune.js";
import { readDataFile } from "icebird/src/read.js";
import { HttpError, anySignal } from "./storage.js";
import { dayOf } from "./tables.js";
import { DAY_MS } from "./tableMeta.js";

const CATALOG_BASE = "https://catalog.mobile.helium.io/api/catalog/v1/mobile";
const CATALOG_TIMEOUT_MS = 15_000;
// Manifest and data files have no fixed time limit: the byte cache abandons
// a download only when its bytes stop arriving (storage.js).
const MANIFEST_CONCURRENCY = 6;

/** `s3://mobileoracles-mainnet/<key>` → its public HTTPS URL. */
function toHttps(path) {
  return path.replace(/^s3a?:\/\/([^/]+)\//, "https://$1.helium.io/");
}

/**
 * Run `fn` over `items` with at most `limit` in flight; results in order.
 * After a failure no new item starts (calls already running finish), so a
 * retry doesn't race the failed attempt's leftovers.
 */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── Table heads ─────────────────────────────────────────────────────────────

// `?snapshots=refs` (the current snapshot only, not the whole history) answers
// HTTP 400 for some tables; those load in full. A table known to (its spec's
// `fullMetadata`) skips the failing request; others are learned here.
const refsUnsupported = new Set();

function catalogFetch(url, signal) {
  // `no-cache` revalidates with the catalog's ETag: an unchanged table is a
  // 304 the browser answers from its HTTP cache.
  return fetch(url, { cache: "no-cache", signal: anySignal(signal, AbortSignal.timeout(CATALOG_TIMEOUT_MS)) });
}

/**
 * A table's current metadata. Snapshot ids exceed 2^53, so the JSON is parsed
 * losslessly (BigInt) and ids are compared as strings. `signal` cancels it.
 * @returns {Promise<{ metadata, snapshotId: string|null }>}
 */
export async function loadTableHead(spec, { signal } = {}) {
  const { ref } = spec;
  const dot = ref.lastIndexOf(".");
  const base = `${CATALOG_BASE}/namespaces/${encodeURIComponent(ref.slice(0, dot))}/tables/${encodeURIComponent(ref.slice(dot + 1))}`;
  let res = null;
  if (!spec.fullMetadata && !refsUnsupported.has(ref)) {
    res = await catalogFetch(`${base}?snapshots=refs`, signal);
    if (res.status === 400) {
      refsUnsupported.add(ref);
      res.body?.cancel().catch(() => {});
      res = null;
    }
  }
  res ??= await catalogFetch(base, signal);
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new HttpError(res.status);
  }
  const { metadata } = parseIcebergJson(await res.text());
  const id = metadata["current-snapshot-id"];
  return { metadata, snapshotId: id == null || id < 0 ? null : String(id) };
}

// ── Planning ────────────────────────────────────────────────────────────────

// Decoded manifest lists and manifests, by path (immutable once written).
const MANIFEST_LIST_MEMO_MAX = 12;
const MANIFEST_MEMO_MAX = 800;
const manifestListMemo = new Map();
const manifestMemo = new Map();

// A pending load started by a cancelled check is not shared: it is about to
// reject with the cancellation.
function memoize(map, max, key, load, signal) {
  const hit = map.get(key);
  if (hit && (hit.settled || !hit.signal?.aborted)) {
    map.delete(key);
    map.set(key, hit);
    return hit.p;
  }
  const entry = { p: load(), signal, settled: false };
  map.set(key, entry);
  entry.p.then(
    () => {
      entry.settled = true;
    },
    () => map.get(key) === entry && map.delete(key),
  );
  while (map.size > max) map.delete(map.keys().next().value);
  return entry.p;
}

/** An icebird resolver over the byte cache. `slice` must not use `this`. */
function resolverFor(bytes, opts) {
  return {
    async reader(path) {
      const buf = await bytes.get(toHttps(path), opts);
      return { byteLength: buf.byteLength, slice: (s, e) => buf.slice(s, e) };
    },
  };
}

function currentSchema(metadata) {
  const schema = metadata.schemas.find((s) => s["schema-id"] === metadata["current-schema-id"]);
  if (!schema) throw new Error("current schema missing from table metadata");
  return schema;
}

function partitionDayMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v * DAY_MS;
  if (typeof v === "bigint") return Number(v) * DAY_MS;
  return null;
}

/** A data file's upper bound on `fieldId` (a timestamptz), in ms. */
function upperBoundMs(dataFile, fieldId) {
  const list = dataFile.upper_bounds;
  const entry = Array.isArray(list) ? list.find((e) => Number(e?.key) === fieldId) : null;
  const b = entry?.value;
  if (!(b instanceof Uint8Array) || b.byteLength < 8) return null;
  const micros = new DataView(b.buffer, b.byteOffset, 8).getBigInt64(0, true);
  return Number(micros / 1000n);
}

const startOfDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;

/** `count` UTC days ending at `newest` ("YYYY-MM-DD"), newest first. */
function dayRange(newest, count) {
  const anchor = new Date(`${newest}T00:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) => dayOf(anchor - i * DAY_MS));
}

/**
 * Plan a table's window from its current snapshot: the data files the window
 * needs, pruned by partition value and per-file time bounds. `signal` cancels
 * the manifest reads.
 *
 * @returns {Promise<{ snapshotId, metadata, schema, files: Map<url, File>, days: string[], present: Set<string> }>}
 *   File: { url, entry, size, day, timeUpper, priority, expireAt }. `days` /
 *   `present` describe a "days" window (newest first; days with data).
 */
export async function planTable(spec, head, bytes, now = Date.now(), { signal } = {}) {
  const { metadata, snapshotId } = head;
  const plan = { snapshotId, metadata, schema: null, files: new Map(), days: [], present: new Set() };
  const { kind } = spec.window;
  if (!snapshotId) {
    if (kind === "days") plan.days = dayRange(dayOf(startOfDay(now) - DAY_MS), spec.window.days);
    return plan;
  }
  const schema = (plan.schema = currentSchema(metadata));
  const field = schema.fields.find((f) => f.name === spec.timeColumn);
  if (!field) throw new Error(`${spec.ref}: no ${spec.timeColumn} column`);

  const since =
    kind === "sliding" ? now - spec.window.ms : kind === "days" ? startOfDay(now) - spec.window.lookbackDays * DAY_MS : null;
  const filter = since == null ? undefined : { [spec.timeColumn]: { $gte: new Date(since) } };

  // A sliding table's manifest list changes every commit (~16 min), so it's
  // kept in memory only; daily tables' lists persist across reloads.
  const listPath = metadata.snapshots.find((s) => String(s["snapshot-id"]) === snapshotId)?.["manifest-list"];
  const { manifests } = await memoize(
    manifestListMemo,
    MANIFEST_LIST_MEMO_MAX,
    listPath ?? snapshotId,
    () =>
      icebergManifestList({
        metadata,
        resolver: resolverFor(bytes, { table: `${spec.ref}:meta`, persist: kind !== "sliding", signal }),
      }),
    signal,
  );
  if (manifests.some((m) => m.content === 1)) {
    // These tables are append-only; delete files would need applying.
    console.warn(`[wallet-dashboard] ${spec.ref} has delete files; they are not applied.`);
  }
  const selected = manifests.filter((m) => m.content === 0 && (!filter || manifestMightMatch(filter, m, schema, metadata)));
  const manifestResolver = resolverFor(bytes, { table: `${spec.ref}:meta`, signal });
  const lists = await mapLimit(selected, MANIFEST_CONCURRENCY, (m) =>
    memoize(manifestMemo, MANIFEST_MEMO_MAX, m.manifest_path, () => fetchManifestEntries(m, manifestResolver), signal),
  );

  const partField = metadata["partition-specs"]
    .find((s) => s["spec-id"] === metadata["default-spec-id"])
    ?.fields.find((f) => f["source-id"] === field.id)?.name;
  const candidates = [];
  for (const entry of lists.flat()) {
    if (entry.status === 2 || entry.data_file.content !== 0) continue;
    if (filter && !(partitionMightMatch(filter, entry, schema, metadata) && fileMightMatch(filter, entry, schema))) continue;
    const day = partField ? partitionDayMs(entry.data_file.partition?.[partField]) : null;
    const timeUpper = upperBoundMs(entry.data_file, field.id) ?? (day == null ? null : day + DAY_MS);
    candidates.push({
      url: toHttps(entry.data_file.file_path),
      entry,
      size: Number(entry.data_file.file_size_in_bytes),
      day: day == null ? null : dayOf(day),
      timeUpper,
      priority: 0,
      // Cached bytes and extracts stay useful this long; null = while used.
      expireAt: kind === "all" || timeUpper == null ? null : timeUpper + spec.retainMs,
    });
  }

  if (kind === "days") {
    // The `days` UTC days ending at the newest day with data (a gap inside
    // the range is a missing day, never skipped). The newest day reads first.
    for (const f of candidates) if (f.day) plan.present.add(f.day);
    const newest = [...plan.present].sort().at(-1) ?? dayOf(startOfDay(now) - DAY_MS);
    plan.days = dayRange(newest, spec.window.days);
    const inRange = new Set(plan.days);
    for (const f of candidates) {
      if (!inRange.has(f.day)) continue;
      f.priority = f.day === newest ? 0 : 1;
      plan.files.set(f.url, f);
    }
  } else {
    for (const f of candidates) plan.files.set(f.url, f);
  }
  return plan;
}

/** Whether a planned file still overlaps a sliding window at `now`. */
export function fileInWindow(spec, file, now = Date.now()) {
  if (spec.window.kind !== "sliding" || file.timeUpper == null) return true;
  return file.timeUpper >= now - spec.window.ms;
}

// ── Reading ─────────────────────────────────────────────────────────────────

/**
 * One data file's rows for a set of keys, normalized by the table spec. The
 * whole file is read in one GET (the key column is most of every file and
 * keys are unordered, so range reads save nothing); the sliding window's time
 * filter prunes pages where the file has a page index. `spec.scan` sees every
 * row in the window (per-file meta such as the epoch price). `signal`
 * cancels the download.
 * @returns {Promise<{ rows: object[], meta: object }>}
 */
export async function extractFile(spec, plan, file, keySet, bytes, now = Date.now(), { signal } = {}) {
  const buf = await bytes.get(file.url, {
    table: spec.ref,
    expireAt: file.expireAt ?? undefined,
    size: file.size,
    signal,
  });
  const resolver = {
    reader: () => ({ byteLength: buf.byteLength, slice: (s, e) => buf.slice(s, e) }),
  };
  const filter =
    spec.window.kind === "sliding" ? { [spec.timeColumn]: { $gte: new Date(now - spec.window.ms) } } : undefined;
  const rows = [];
  const meta = {};
  for await (const batch of readDataFile({
    dataEntry: file.entry,
    fileRowStart: 0,
    fileRowEnd: Number(file.entry.data_file.record_count),
    schema: plan.schema,
    metadata: plan.metadata,
    resolver,
    rowLineage: false,
    wantedColumns: spec.columns,
    filter,
  })) {
    for (const r of batch) {
      spec.scan?.(r, meta);
      if (keySet.has(r[spec.keyColumn])) rows.push(spec.normalize(r));
    }
  }
  return { rows, meta };
}
