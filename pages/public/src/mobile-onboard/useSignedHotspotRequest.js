import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { signCertRequest } from "./certRequest.js";

/**
 * The shared wallet-signature flow behind every ownership-gated request in this
 * tool: the wizard's CertStep (create certificates, with address + NAS ID), the
 * Manage detail (re-fetch certificates), and the agent brief (mint capability
 * links). All three sign the identical payload — a 2xx from Nova is the
 * ownership proof — and differ only in which endpoint consumes it.
 *
 * Owns the `idle | signing | requesting | done` state machine, wallet-decline
 * detection, and the `signMessage` capability check, so the call sites can't
 * drift apart. They have before: a call site that rolled its own copy left its
 * button enabled without `canSign`, making it a silent no-op on a wallet that
 * can't sign offchain.
 *
 * @param {string} gatewayKey  the Hotspot's Helium entity key
 * @param {(payload: object) => Promise<object>} request  endpoint call; memoize
 *   it at the call site if it closes over changing values
 */
export default function useSignedHotspotRequest(gatewayKey, request) {
  const { publicKey, signMessage } = useWallet();
  const [state, setState] = useState("idle"); // idle | signing | requesting | done
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const submit = useCallback(async (info) => {
    setError(null);
    // Guard the offchain-signing capability up front so a wallet that
    // disconnected (or can't signMessage) yields a clear message instead of a
    // raw TypeError from publicKey.toBase58().
    if (!signMessage || !publicKey) {
      setError("Connect a software wallet that owns this Hotspot to continue.");
      return;
    }
    setState("signing");
    try {
      const payload = await signCertRequest(signMessage, publicKey.toBase58(), gatewayKey, info);
      setState("requesting");
      setResult(await request(payload));
      setState("done");
    } catch (err) {
      setError(/reject|declin|cancel/i.test(err.message || "")
        ? "Signature request was declined in the wallet."
        : err.message);
      setState("idle");
    }
  }, [signMessage, publicKey, gatewayKey, request]);

  return {
    state,
    error,
    result,
    busy: state === "signing" || state === "requesting",
    // signMessage is undefined on wallets without offchain signing (Ledger).
    canSign: !!signMessage && !!publicKey,
    submit,
  };
}
