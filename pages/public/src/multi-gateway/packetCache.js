// Tiny IndexedDB-backed cache of recent packets per Hotspot mac. Lives
// inside the packet worker so writes happen on a non-blocking thread.
// On reload, `subscribePackets` reads the cache for the selected mac and
// emits a `cached_packets` event before the network fetch lands — the
// chart paints something familiar in tens of milliseconds, then the
// authoritative batch overwrites it once the fetch resolves.
//
// Schema: one record per mac, value = { mac, packets: Packet[] }.
// Keyed dedup uses (dev_addr, fcnt, timestamp) since `_id` is per-session.

const DB_NAME = "multi-gateway";
const STORE = "packets";
const VERSION = 1;
const MAX_CACHED = 500;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "mac" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("indexedDB blocked"));
  });
  // Clear the cached handle on failure so the next call retries instead of
  // returning a permanently-rejected promise (private mode, quota, etc.).
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

// Open the DB connection up front so the first `subscribePackets` doesn't
// pay the open-cost in line with the user's first render. No-op on success.
export async function hydrateCache() {
  await openDb();
}

export async function readPackets(mac) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(mac);
    req.onsuccess = () => resolve(req.result?.packets ?? []);
    req.onerror = () => reject(req.error);
  });
}

function dedupeKey(p) {
  // _id is per-session so it can't anchor dedup across reloads. fcnt may be
  // null (joins/downlinks); timestamp is always present.
  return `${p.dev_addr ?? ""}:${p.fcnt ?? ""}:${p.timestamp}`;
}

export async function writePackets(mac, incoming) {
  if (!incoming.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(mac);
    getReq.onsuccess = () => {
      const existing = getReq.result?.packets ?? [];
      const merged = new Map(existing.map((p) => [dedupeKey(p), p]));
      for (const p of incoming) merged.set(dedupeKey(p), p);
      const list = [...merged.values()].sort((a, b) => a.timestamp - b.timestamp);
      const trimmed = list.length > MAX_CACHED ? list.slice(-MAX_CACHED) : list;
      store.put({ mac, packets: trimmed });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
