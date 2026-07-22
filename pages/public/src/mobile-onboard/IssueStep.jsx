import { useEffect, useRef, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { signAndBroadcast } from "../dc-mint/solanaUtils.js";
import { requestIssue, fetchGatewayStatus } from "../lib/mobileOnboardApi.js";

const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_TRIES = 24; // 2 minutes

/**
 * Step 2: register the Hotspot entity on-chain (issue_data_only_entity_v0,
 * co-signed by the Helium ECC verifier, paid by the connected wallet — a
 * SOL network fee only, no DC yet). After the transaction confirms, the
 * indexer can take up to ~a minute to make the new entity visible, so the
 * step ends in a polling sub-state and auto-advances once /status reports it
 * issued.
 */
export default function IssueStep({ gateway, issuePayload, onIssued }) {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [state, setState] = useState("ready"); // ready | building | signing | indexing | timeout | error
  const [error, setError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);
  const [pollCount, setPollCount] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const pollUntilIndexed = async () => {
    setState("indexing");
    for (let i = 0; i < POLL_MAX_TRIES; i++) {
      if (cancelledRef.current) return;
      setPollCount(i + 1);
      try {
        const status = await fetchGatewayStatus(gateway.b58);
        if (cancelledRef.current) return;
        // `issued` flips as soon as the txn confirms, but /onboard's DAS
        // reads need `indexed` too — advancing early would hand the user a
        // doomed onboard build.
        if (status.issued && status.indexed) {
          onIssued();
          return;
        }
      } catch {
        // transient — keep polling
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!cancelledRef.current) setState("timeout");
  };

  const handleIssue = async () => {
    setError(null);
    setState("building");
    try {
      const result = await requestIssue(
        publicKey.toBase58(),
        gateway.b58,
        issuePayload.unsignedMsgHex,
        issuePayload.signatureHex,
      );
      if (result.already_issued) {
        await pollUntilIndexed(); // resolves on the first poll
        return;
      }
      setState("signing");
      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      const sig = await signAndBroadcast(txn, publicKey, sendTransaction, connection);
      if (cancelledRef.current) return;
      setTxSignature(sig);
      await pollUntilIndexed();
    } catch (err) {
      if (!cancelledRef.current) {
        setError(err.message);
        setState("error");
      }
    }
  };

  const busy = state === "building" || state === "signing" || state === "indexing";

  return (
    <div className="space-y-4">
      <p className="text-sm text-content-secondary">
        Register <span className="font-medium text-content">{gateway.name}</span> on-chain. Your
        wallet pays the Solana network fee (~0.005 SOL). The Data Credits fee comes in the next
        step with the location.
      </p>

      {state === "indexing" && (
        <div className="rounded-lg bg-surface-inset p-4">
          <p className="text-sm font-medium text-content">Waiting for the network to index your Hotspot…</p>
          <p className="mt-1 text-xs text-content-tertiary">
            The registration transaction {txSignature ? "confirmed" : "is in"}. Indexing usually
            takes under a minute. Check {pollCount}/{POLL_MAX_TRIES}.
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${Math.min(100, (pollCount / POLL_MAX_TRIES) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {state === "timeout" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/40 dark:text-amber-300">
          The transaction {txSignature ? "succeeded" : "was submitted"} but the Hotspot hasn't shown
          up in the index yet. Your draft is saved, so you can retry now or resume later from this
          page. Nothing is lost.
        </div>
      )}

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {txSignature && (
        <a
          href={`https://solscan.io/tx/${txSignature}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-accent-text hover:underline"
        >
          View transaction <ArrowTopRightOnSquareIcon className="h-4 w-4" />
        </a>
      )}

      {state !== "indexing" && (
        <button
          onClick={state === "timeout" ? pollUntilIndexed : handleIssue}
          disabled={busy || !publicKey}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {state === "building" ? "Building transaction…"
            : state === "signing" ? "Confirm in wallet…"
            : state === "timeout" ? "Check again"
            : "Register on-chain"}
        </button>
      )}
    </div>
  );
}
