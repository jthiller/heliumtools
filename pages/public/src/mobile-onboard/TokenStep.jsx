import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
  StopIcon,
} from "@heroicons/react/24/outline";
import CopyButton from "../components/CopyButton.jsx";
import { downloadTextFile } from "../lib/download.js";
import { buildTokenFromPrivateKey } from "./gatewayToken.js";
import { POSITIONS } from "./animalWords.js";
import KeygenWorker from "./keygenWorker.js?worker";

// Exact-word lookup per slot, so a typed value can be validated as a real
// adjective/color/animal (vs. a typo that could never match).
const WORD_SETS = Object.fromEntries(POSITIONS.map((p) => [p.key, new Set(p.words)]));
const EMPTY_TARGET = { adjective: "", color: "", animal: "" };

const GRIND_HINTS = {
  0: "Pick a word for any slot to grind toward it, or reroll for a random name.",
  1: "About 1 in 256 keys. Usually instant.",
  2: "About 1 in 65,000 keys. A few seconds.",
  3: "About 1 in 16.7 million keys. This can take many minutes.",
};

/**
 * Step 1: create the gateway onboarding token in the browser (the equivalent
 * of `helium-wallet hotspots add mobile token`).
 *
 * The user can reroll random keys or grind toward an angry-purple-tiger name
 * they like; the search runs in keygenWorker.js so the UI never blocks. The
 * onboarding token is only built (signing the chosen key) when the user
 * commits with "Use this key", at which point the private key is used once and
 * discarded — only the public token (no private key) is passed upward and kept
 * in the draft.
 */
export default function TokenStep({ gateway, token, onToken, onContinue }) {
  const committed = Boolean(gateway && token);

  const [error, setError] = useState(null);

  // Uncommitted key-grind state. `current`/`matches` hold candidates
  // { id, b58, name, priv } — priv is a throwaway gateway key, never persisted.
  const [current, setCurrent] = useState(null);
  const [matches, setMatches] = useState([]);
  const [target, setTarget] = useState(EMPTY_TARGET);
  const [grinding, setGrinding] = useState(false);
  const [tried, setTried] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const workerRef = useRef(null);
  // Latest `current`, read inside the worker effect without making it a dep
  // (which would recreate the worker on every reroll/grind result).
  const currentRef = useRef(current);
  currentRef.current = current;

  // The key-grind worker lives only while the user is choosing a key.
  useEffect(() => {
    if (committed) return undefined;
    const worker = new KeygenWorker();
    workerRef.current = worker;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "candidate") {
        const cand = { id: m.id, b58: m.b58, name: m.name, priv: Uint8Array.from(m.privateKey) };
        if (m.matched) {
          setMatches((prev) => [...prev, cand]);
          setCurrent((cur) => cur || cand); // auto-select the first match
        } else {
          setCurrent(cand); // a reroll
          setMatches([]);
        }
      } else if (m.type === "progress") {
        setTried(m.tried);
        setElapsedMs(m.elapsedMs);
      } else if (m.type === "done") {
        setGrinding(false);
        setTried(m.tried);
        setElapsedMs(m.elapsedMs);
      }
    };
    // Pre-roll a key on open so a name is ready immediately — the user can use
    // it, reroll, or grind. Skip if a candidate already exists (e.g. a dev
    // StrictMode remount) so we don't clobber the selection.
    if (!currentRef.current) worker.postMessage({ cmd: "reroll" });
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [committed]);

  const rate = useMemo(
    () => (grinding && elapsedMs > 0 ? Math.round((tried / elapsedMs) * 1000) : 0),
    [grinding, tried, elapsedMs],
  );

  // Validate each slot against its dictionary: normalize the valid words into
  // the grind target, count active/invalid slots for the button + hint.
  const { normalizedTarget, activeCount, invalidCount } = useMemo(() => {
    const norm = {};
    let active = 0;
    let invalid = 0;
    for (const { key } of POSITIONS) {
      const v = target[key].trim().toLowerCase();
      if (!v) { norm[key] = ""; }
      else if (WORD_SETS[key].has(v)) { norm[key] = v; active++; }
      else { norm[key] = ""; invalid++; }
    }
    return { normalizedTarget: norm, activeCount: active, invalidCount: invalid };
  }, [target]);

  const reroll = () => {
    setError(null);
    setGrinding(false);
    setMatches([]);
    workerRef.current?.postMessage({ cmd: "reroll" });
  };

  const startGrind = () => {
    if (invalidCount > 0) return;
    if (activeCount === 0) {
      reroll();
      return;
    }
    setError(null);
    setMatches([]);
    setCurrent(null);
    setTried(0);
    setElapsedMs(0);
    setGrinding(true);
    workerRef.current?.postMessage({ cmd: "grind", match: normalizedTarget });
  };

  const stopGrind = () => {
    workerRef.current?.postMessage({ cmd: "stop" });
    setGrinding(false);
  };

  const useKey = () => {
    if (!current) return;
    setError(null);
    // Proceeding is terminal: stop any in-flight grind rather than making the
    // user wait for it to finish or Stop first.
    if (grinding) {
      workerRef.current?.postMessage({ cmd: "stop" });
      setGrinding(false);
    }
    try {
      const built = buildTokenFromPrivateKey(current.priv);
      onToken({
        gateway: { b58: built.gatewayB58, name: built.animalName },
        token: built.token,
        issuePayload: { unsignedMsgHex: built.unsignedMsgHex, signatureHex: built.signatureHex },
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDownloadToken = () => {
    downloadTextFile(`${gateway.name.toLowerCase().replace(/ /g, "-")}-token.txt`, token);
  };

  // Committed: show the saved token to back up before registering.
  if (committed) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-surface-inset p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-content-tertiary">Your new Hotspot</p>
          <p className="mt-1 font-display text-lg font-semibold text-content">{gateway.name}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <p className="break-all font-mono text-xs text-content-tertiary">{gateway.b58}</p>
            <CopyButton text={gateway.b58} size="h-3.5 w-3.5" />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-content-secondary">Onboarding token</label>
            <div className="flex items-center gap-2">
              <CopyButton text={token} size="h-3.5 w-3.5" />
              <button
                type="button"
                onClick={handleDownloadToken}
                title="Download token"
                className="text-content-tertiary hover:text-content-secondary"
              >
                <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="max-h-24 overflow-y-auto break-all rounded-lg bg-surface-inset p-3 font-mono text-[11px] leading-relaxed text-content-secondary">
            {token}
          </div>
          <p className="mt-2 text-xs text-content-tertiary">
            Save this token before continuing. heliumtools does not store it. It contains no private
            key, and once the registration transaction confirms you will not need it again. This page
            also keeps a local draft so you can resume in this browser.
          </p>
        </div>

        <button
          onClick={onContinue}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
        >
          Continue to registration
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {current ? (
        <div className="rounded-lg bg-surface-inset p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-content-tertiary">Selected Hotspot name</p>
          <p className="mt-1 font-display text-lg font-semibold text-content">{current.name}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <p className="break-all font-mono text-xs text-content-tertiary">{current.b58}</p>
            <CopyButton text={current.b58} size="h-3.5 w-3.5" />
          </div>
        </div>
      ) : (
        <p className="text-sm text-content-secondary">
          Every converted network gets its own Hotspot key, generated in your browser. Roll for one
          you like, or grind toward a name. Your wallet stays the owner and signs everything else.
        </p>
      )}

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          {POSITIONS.map((p) => {
            const raw = target[p.key].trim();
            const invalid = raw.length > 0 && !WORD_SETS[p.key].has(raw.toLowerCase());
            return (
              <div key={p.key}>
                <input
                  list={`apt-${p.key}`}
                  value={target[p.key]}
                  onChange={(e) => setTarget((t) => ({ ...t, [p.key]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !grinding && invalidCount === 0) startGrind(); }}
                  placeholder={p.label}
                  disabled={grinding}
                  className={`w-full rounded-lg border bg-surface-inset px-3 py-2 text-sm text-content placeholder:text-content-tertiary focus:outline-none focus:ring-1 disabled:opacity-50 ${
                    invalid
                      ? "border-rose-400 focus:border-rose-400 focus:ring-rose-400"
                      : "border-border focus:border-accent focus:ring-accent"
                  }`}
                />
                <datalist id={`apt-${p.key}`}>
                  {p.words.map((w) => <option key={w} value={w} />)}
                </datalist>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {grinding ? (
            <button
              onClick={stopGrind}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-content hover:bg-surface-inset"
            >
              <StopIcon className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button
              onClick={startGrind}
              disabled={invalidCount > 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <MagnifyingGlassIcon className="h-4 w-4" /> {activeCount > 0 ? "Grind" : "Generate"}
            </button>
          )}
          <button
            onClick={reroll}
            disabled={grinding}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-content hover:bg-surface-inset disabled:opacity-50"
          >
            <ArrowPathIcon className="h-4 w-4" /> Reroll
          </button>
          {grinding && (
            <span className="ml-auto font-mono text-xs text-content-tertiary">
              tried {tried.toLocaleString()}{rate > 0 ? ` · ${rate.toLocaleString()}/s` : ""}
            </span>
          )}
        </div>

        <p className="text-[11px] text-content-tertiary">
          {invalidCount > 0
            ? "One of those isn't a valid word for that slot. Pick from the suggestions."
            : GRIND_HINTS[activeCount]}
        </p>
      </div>

      {matches.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs">
            <span className="font-medium text-content-secondary">
              {grinding ? "Matches so far" : "Matches"}
            </span>
            <span className="text-content-tertiary"> · pick one to use</span>
          </p>
          <ul className="flex flex-wrap items-center gap-1.5">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => setCurrent(m)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    current?.id === m.id
                      ? "border-accent text-accent-text"
                      : "border-border text-content-secondary hover:border-accent"
                  }`}
                >
                  {m.name}
                </button>
              </li>
            ))}
            {grinding && (
              <li aria-hidden="true" className="flex items-center px-1 text-content-tertiary">
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
              </li>
            )}
          </ul>
        </div>
      )}

      {error && <p className="text-xs text-rose-500">{error}</p>}

      <button
        onClick={useKey}
        disabled={!current}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        <KeyIcon className="h-4 w-4 shrink-0" />
        <span className="truncate">{current ? `Use "${current.name}"` : "Use this key"}</span>
      </button>
    </div>
  );
}
