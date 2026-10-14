// Main-thread side of the Mobile activity worker: spawns it lazily (one per
// page, reused across wallet switches), schedules checks, merges its posts
// into the assembled state, and saves each finished check for instant paint.
//
// Schedule: a check every 2 min while the page is visible, and a re-assemble
// every 30 s between them so the 60-min heartbeat window slides. Hidden
// pages pause; becoming visible checks right away if the last check is more
// than 2 min old. (Unchanged tables cost a catalog 304 each.) Stopping (a
// wallet switch, a cleared wallet, one without Mobile Hotspots) cancels the
// worker's running check, downloads included.
//
// `checkMobileOnce` is the one-shot variant for a wallet that isn't on
// screen (the agent tool), in a worker of its own.
import MobileWorker from "./mobileWorker.js?worker";
import { writePaint } from "./paintCache.js";
import { CHECK_INTERVAL_MS, FRESH_MS } from "./tables.js";

const ASSEMBLE_INTERVAL_MS = 30_000;
// How long a one-shot worker may keep writing its caches after answering.
const SETTLE_MAX_MS = 5000;

const isVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

/**
 * The worker's state after one of its posts (see mobileWorker.js): a full
 * state replaces it; a patch replaces the fields it carries and moves the
 * other sliding sections' `until`. Unchanged sections keep their identity.
 */
export function applyPost(prev, msg) {
  if (!msg.patch || !prev) return msg.state;
  const next = { ...prev, ...msg.state };
  for (const [name, until] of Object.entries(msg.until || {})) {
    const section = next[name];
    if (section && section.until !== until) next[name] = { ...section, until };
  }
  return next;
}

/**
 * @returns {{ start(opts, onUpdate): () => void, destroy(): void }}
 *   start({ wallet, keys, wifi, totals }, onUpdate): begins (or switches to)
 *   a wallet; onUpdate receives `{ state, final }` (the assembled state; final
 *   once per finished check), `{ paused }`, `{ stale: true }` (the last
 *   finished check is older than FRESH_MS; the next final clears it) and
 *   `{ failed }` (the worker itself failed). Returns a stop function. Only the
 *   latest start's updates are delivered.
 */
export function createMobileClient() {
  let worker = null;
  let session = 0;
  // { session, wallet, keys, wifi, totals, onUpdate, lastCheckAt, lastFinalAt, staleNoted, state }
  let active = null;
  let timer = null;

  function ensureWorker() {
    if (worker) return worker;
    const w = new MobileWorker();
    let replied = false;
    w.onmessage = (e) => {
      replied = true;
      const msg = e.data;
      if (!active || msg?.type !== "state" || msg.session !== active.session) return;
      active.state = applyPost(active.state, msg);
      if (msg.final) {
        active.lastFinalAt = Date.now();
        active.staleNoted = false;
      }
      active.onUpdate({ state: active.state, final: Boolean(msg.final) });
      if (msg.final) writePaint(active.wallet, active.state, active.totals);
    };
    const fail = (message) => {
      if (worker !== w) return;
      console.error("[wallet-dashboard] Mobile worker", message);
      // A worker that never answered didn't load (a missing chunk after a
      // deploy, say): drop it, and the next due check starts a new one. One
      // that did answer keeps running after an uncaught error.
      if (!replied) {
        w.terminate();
        worker = null;
      }
      active?.onUpdate({ failed: message });
    };
    w.onerror = (e) => fail(e.message || "worker error");
    w.onmessageerror = () => fail("worker message error");
    worker = w;
    return w;
  }

  function startMessage() {
    return { type: "start", session: active.session, wallet: active.wallet, keys: active.keys, wifi: active.wifi };
  }

  // The data is older than FRESH_MS (the page was hidden or asleep, or a
  // check is slow): say so until the next check finishes.
  function noteStale() {
    if (!active?.lastFinalAt || active.staleNoted || Date.now() - active.lastFinalAt <= FRESH_MS) return;
    active.staleNoted = true;
    active.onUpdate({ stale: true });
  }

  function tick() {
    if (!active || !isVisible()) return;
    noteStale();
    const due = Date.now() - active.lastCheckAt >= CHECK_INTERVAL_MS;
    if (!worker) {
      if (!due) return;
      active.lastCheckAt = Date.now();
      active.state = null;
      ensureWorker().postMessage(startMessage());
    } else if (due) {
      active.lastCheckAt = Date.now();
      worker.postMessage({ type: "refresh", session: active.session });
    } else {
      worker.postMessage({ type: "assemble", session: active.session });
    }
  }

  function onVisibility() {
    if (!active) return;
    const visible = isVisible();
    active.onUpdate({ paused: !visible });
    if (visible) tick();
  }

  function startTimers() {
    if (timer) return;
    timer = setInterval(tick, ASSEMBLE_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
  }

  function stopTimers() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisibility);
  }

  function start({ wallet, keys, wifi, totals }, onUpdate) {
    const mySession = ++session;
    active = {
      session: mySession,
      wallet,
      keys,
      wifi,
      totals,
      onUpdate,
      lastCheckAt: Date.now(),
      lastFinalAt: 0,
      staleNoted: false,
      state: null,
    };
    ensureWorker().postMessage(startMessage());
    startTimers();
    onUpdate({ paused: !isVisible() });
    return () => {
      if (active?.session !== mySession) return;
      // Cancel the check: no downloads for a wallet no longer on screen.
      worker?.postMessage({ type: "stop", session: mySession });
      active = null;
      stopTimers();
    };
  }

  function destroy() {
    active = null;
    stopTimers();
    worker?.terminate();
    worker = null;
  }

  return { start, destroy };
}

/**
 * One check of a wallet in its own short-lived worker, for a wallet that
 * isn't on screen (the agent tool). Same engine and the same byte and
 * extract caches as the page's worker, but no schedule and no saved paint
 * (it never displaces the user's recent wallets). After answering, the
 * worker gets up to SETTLE_MAX_MS to finish writing its caches.
 *
 * @returns {Promise<{ state, timedOut: boolean }>} the finished state, or
 *   after `timeoutMs` the latest partial one (tables still "loading"; the
 *   check is then cancelled, keeping the files it finished).
 *   Rejects only if the worker itself fails.
 */
export function checkMobileOnce({ wallet, keys, wifi }, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new MobileWorker();
    let state = null;
    let answered = false;
    let settleTimer = null;
    const end = () => {
      clearTimeout(timer);
      clearTimeout(settleTimer);
      worker.terminate();
    };
    const answer = (result) => {
      answered = true;
      clearTimeout(timer);
      resolve(result);
      settleTimer = setTimeout(end, SETTLE_MAX_MS);
    };
    const timer = setTimeout(() => {
      worker.postMessage({ type: "stop", session: 1 });
      answer({ state, timedOut: true });
    }, timeoutMs);
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg?.type === "settled") return end();
      if (msg?.type !== "state" || answered) return;
      state = applyPost(state, msg);
      if (msg.final) answer({ state, timedOut: false });
    };
    worker.onerror = (e) => {
      end();
      if (!answered) {
        answered = true;
        reject(new Error(e.message || "worker error"));
      }
    };
    worker.postMessage({ type: "start", session: 1, wallet, keys, wifi, once: true });
  });
}
