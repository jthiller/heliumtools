// Web Worker that grinds gateway keypairs off the main thread so the UI stays
// responsive. It generates ed25519 identities, computes each one's
// angry-purple-tiger name (adjective color animal), and either returns a
// single reroll or streams the ones whose name matches a positional target
// (any subset of the three word slots).
//
// Private keys of returned candidates ride along in the message (32 bytes
// each) so the main thread can build the token for the chosen one; the worker
// keeps nothing after it posts. Non-matching keys are discarded immediately.
import { randomIdentity } from "./gatewayKey.js";

// Grind in short time slices, yielding between them so a `stop` message (or a
// reroll) is handled within a frame instead of after a fixed key count that
// varies wildly by device speed.
const SLICE_MS = 12;
// Cap streamed matches so a loose target (e.g. a single common slot) can't
// flood the main thread or grow memory without bound; the user stops or picks.
const MAX_MATCHES = 12;

let nextId = 1;
// Monotonic grind session. A new grind/reroll/stop bumps it, so any loop tick
// still scheduled from a previous grind sees a stale id and bails without
// posting — this is what prevents a fast stop→grind from running two loops at
// once over the same shared state.
let session = 0;

/**
 * Build a positional matcher from a target { adjective, color, animal }, each
 * an exact lowercase dictionary word or empty ("any"). Returns null if no slot
 * is constrained, else { test, constrained } where `constrained` is how many
 * slots are pinned. The name is split on its space separator: [0] adjective,
 * [1] color, [2] animal.
 */
function makeMatcher(match) {
  const want = [match?.adjective || "", match?.color || "", match?.animal || ""].map((w) =>
    w.toLowerCase().trim(),
  );
  const constrained = want.filter(Boolean).length;
  if (constrained === 0) return null;
  const test = (name) => {
    const words = name.toLowerCase().split(" ");
    for (let i = 0; i < 3; i++) {
      if (want[i] && words[i] !== want[i]) return false;
    }
    return true;
  };
  return { test, constrained };
}

function postCandidate(idn, matched) {
  self.postMessage({
    type: "candidate",
    id: nextId++,
    b58: idn.b58,
    name: idn.name,
    matched,
    privateKey: Array.from(idn.privateKey),
  });
}

function grind(matches_fn, cap) {
  const mySession = ++session;
  let tried = 0;
  let matches = 0;
  const started = Date.now();
  let lastProgress = started;

  function loop() {
    if (mySession !== session) return; // superseded by a newer command
    let done = false;
    const sliceStart = Date.now();
    do {
      const idn = randomIdentity();
      tried++;
      if (matches_fn(idn.name)) {
        postCandidate(idn, true);
        if (++matches >= cap) { done = true; break; }
      }
    } while (Date.now() - sliceStart < SLICE_MS);

    const now = Date.now();
    if (now - lastProgress >= 150 || done) {
      self.postMessage({ type: "progress", tried, elapsedMs: now - started });
      lastProgress = now;
    }

    if (done) {
      session++; // close out this session so a trailing tick can't revive it
      self.postMessage({ type: "done", tried, elapsedMs: now - started, matches });
    } else {
      setTimeout(loop, 0);
    }
  }
  loop();
}

self.onmessage = (e) => {
  const msg = e.data || {};
  switch (msg.cmd) {
    case "stop":
      session++; // halt any running grind loop
      break;
    case "reroll":
      session++;
      postCandidate(randomIdentity(), false);
      break;
    case "grind": {
      const matcher = makeMatcher(msg.match);
      // No slot constrained → just hand back one random key.
      if (!matcher) { session++; postCandidate(randomIdentity(), false); break; }
      // A fully specified name has exactly one possible result, so stop at the
      // first hit; looser targets stream a variety to pick from.
      const cap = matcher.constrained === 3 ? 1 : MAX_MATCHES;
      grind(matcher.test, cap);
      break;
    }
    default:
      break;
  }
};
