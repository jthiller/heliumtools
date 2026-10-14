// Web Worker hosting the Wallet Dashboard's Mobile activity engine, so Parquet
// decoding never blocks the page. One per page, reused across wallet
// switches (plans and cached bytes carry over; extracts are per wallet).
//
// Messages in:  { type: "start", session, wallet, keys, wifi, once? }
//               { type: "refresh" | "assemble" | "stop", session }
// Messages out: { type: "state", session, final, state }            (full)
//               { type: "state", session, final, patch: true, state, until }
//               { type: "settled", session }   (a `once` check's caches are written)
// `session` increments per start; the client drops replies for an old one,
// and "stop" cancels that session's check (its downloads too).
//
// Only a session's first post is the full state. Later posts are patches
// (mobileClient.js `applyPost` merges them): the small fields always, plus
// only the sections whose content changed, and `until` (window end) for the
// sliding sections that didn't, so a large fleet's unchanged rewards and
// usage never cross again.
import { createEngine } from "./engine.js";
import { TABLE_NAMES } from "./tables.js";

// Progress during a wallet's first check is throttled; the final state always
// posts. Later checks post only their final state, so new rows arrive in the
// same post as the arrivals that announce them (the page animates from the
// previous values).
const PROGRESS_INTERVAL_MS = 400;

const engine = createEngine();
let session = 0;
let checking = null; // the session whose check is running
let sent = null; // what the page has for the session: { session, sig, seq }

function post(mySession, { sig, ...state }, final = false) {
  if (mySession !== session) return;
  if (sent?.session !== mySession) {
    sent = { session: mySession, sig, seq: state.arrivals.seq };
    self.postMessage({ type: "state", session: mySession, final, state });
    return;
  }
  const patch = {
    wallet: state.wallet,
    checkedAt: state.checkedAt,
    tables: state.tables,
    live: state.live,
    refreshing: state.refreshing,
  };
  const until = {};
  for (const name of TABLE_NAMES) {
    if (sig[name] !== sent.sig[name]) patch[name] = state[name];
    else if (state[name]?.until != null) until[name] = state[name].until;
  }
  if (state.arrivals.seq !== sent.seq) patch.arrivals = state.arrivals;
  sent = { session: mySession, sig, seq: state.arrivals.seq };
  self.postMessage({ type: "state", session: mySession, final, patch: true, state: patch, until });
}

async function refresh(mySession, { once = false } = {}) {
  // A tick that lands mid-check joins it: the running check's final post
  // answers both.
  if (checking === mySession) return;
  checking = mySession;
  let last = 0;
  let state;
  try {
    state = await engine.refresh({
      onProgress: (s) => {
        if (s.live) return;
        const t = Date.now();
        if (t - last < PROGRESS_INTERVAL_MS) return;
        last = t;
        post(mySession, s);
      },
    });
  } catch (err) {
    // Table failures are isolated inside the engine; this is a bug, not data.
    console.error("[wallet-dashboard] Mobile check failed", err);
    state = engine.state();
  } finally {
    if (checking === mySession) checking = null;
  }
  post(mySession, state, true);
  if (once) {
    // A one-shot worker is terminated after this; let its cache writes land.
    await engine.settle();
    self.postMessage({ type: "settled", session: mySession });
  }
}

self.onmessage = (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === "start") {
      session = msg.session;
      engine.setWallet(msg.wallet, msg.keys || [], { wifi: Boolean(msg.wifi) });
      post(session, engine.state());
      refresh(session, { once: Boolean(msg.once) });
      return;
    }
    if (msg.session !== session) return;
    if (msg.type === "stop") {
      // Sessions start at 1: nothing posts until the next start.
      session = 0;
      engine.stop();
    } else if (msg.type === "refresh") refresh(session);
    else if (msg.type === "assemble") {
      const state = engine.reassemble();
      if (state) post(session, state);
    }
  } catch (err) {
    console.error("[wallet-dashboard] Mobile worker message failed", err);
  }
};
