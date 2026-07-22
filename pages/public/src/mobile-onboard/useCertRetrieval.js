import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { requestCert } from "../lib/mobileOnboardApi.js";
import { signCertRequest } from "./certRequest.js";

/**
 * Shared RadSec certificate sign-and-fetch flow for the wizard's CertStep
 * (creation, with address + NAS IDs) and the Manage detail (re-fetch, no
 * info). Owns the `idle | signing | requesting | done` state machine, the
 * wallet-decline detection, and the `signMessage` capability check so the two
 * call sites don't drift apart.
 *
 * @param {string} gatewayKey  the Hotspot's Helium entity key
 */
export default function useCertRetrieval(gatewayKey) {
  const { publicKey, signMessage } = useWallet();
  const [state, setState] = useState("idle"); // idle | signing | requesting | done
  const [error, setError] = useState(null);
  const [cert, setCert] = useState(null);

  const submit = useCallback(async (info) => {
    setError(null);
    setState("signing");
    try {
      const payload = await signCertRequest(signMessage, publicKey.toBase58(), gatewayKey, info);
      setState("requesting");
      setCert(await requestCert(payload));
      setState("done");
    } catch (err) {
      setError(/reject|declin|cancel/i.test(err.message || "")
        ? "Signature request was declined in the wallet."
        : err.message);
      setState("idle");
    }
  }, [signMessage, publicKey, gatewayKey]);

  return {
    state,
    error,
    cert,
    busy: state === "signing" || state === "requesting",
    // signMessage is undefined on wallets without offchain signing (Ledger).
    canSign: !!signMessage && !!publicKey,
    submit,
  };
}
