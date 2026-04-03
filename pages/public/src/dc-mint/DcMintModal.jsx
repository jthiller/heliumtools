/**
 * Modal variant of DC minting for embedding in other tools (e.g. multi-gateway onboarding).
 * Uses the already-connected wallet from SolanaProvider context.
 */
import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { buildMintTransaction, fetchHntPrice } from "../lib/dcMintApi.js";
import { HNT_MINT, DC_MINT } from "./constants.js";
import { confirmAndVerify } from "./solanaUtils.js";

export default function DcMintModal({ onClose, onSuccess, defaultDcAmount = 100000 }) {
  const { publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [amount, setAmount] = useState(defaultDcAmount.toString());
  const [hntPrice, setHntPrice] = useState(null);
  const [hntBalance, setHntBalance] = useState(null);
  const [hasDcAta, setHasDcAta] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchHntPrice().then(setHntPrice).catch(() => {});
  }, []);

  useEffect(() => {
    if (!walletPubkey || !connection) return;
    let cancelled = false;
    Promise.all([
      connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: HNT_MINT }),
      connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: DC_MINT }),
    ]).then(([hntAccounts, dcAccounts]) => {
      if (cancelled) return;
      const hntAcc = hntAccounts.value[0];
      setHntBalance(hntAcc ? Number(hntAcc.account.data.parsed.info.tokenAmount.uiAmount) : 0);
      setHasDcAta(!!dcAccounts.value[0]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [walletPubkey, connection]);

  const isValidDc = /^[1-9]\d*$/.test(amount.trim());
  const dcVal = isValidDc ? parseInt(amount, 10) : 0;
  const hntNeeded = hntPrice && dcVal > 0 && hntPrice.dc_per_hnt > 0 ? dcVal / hntPrice.dc_per_hnt : null;

  const handleMint = async () => {
    if (!walletPubkey || !sendTransaction || !isValidDc) return;
    setError(null);
    setStatus("building");
    try {
      const result = await buildMintTransaction({
        owner: walletPubkey.toBase58(),
        dc_amount: dcVal,
      });
      setStatus("signing");
      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      const sig = await sendTransaction(txn, connection);
      setStatus("confirming");
      await confirmAndVerify(connection, sig);
      setStatus("done");
      onSuccess?.(sig);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-surface-raised p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-content-primary">Mint Data Credits</h3>
          <button onClick={onClose} className="text-content-tertiary hover:text-content-secondary">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-2 text-xs text-content-tertiary">
          Convert HNT from your connected wallet into Data Credits.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-content-secondary">DC to mint</label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              className="mt-1 w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {hntPrice && hntNeeded != null && (
            <div className="rounded-lg border border-border bg-surface-inset p-3 text-xs space-y-1">
              <div className="flex justify-between text-content-secondary">
                <span>HNT to burn</span>
                <span className="font-mono">{hntNeeded.toFixed(4)} HNT (~${(hntNeeded * hntPrice.hnt_usd).toFixed(2)})</span>
              </div>
              <div className="flex justify-between text-content-secondary">
                <span>Your HNT balance</span>
                <span className="font-mono">{hntBalance != null ? hntBalance.toFixed(4) : "..."}</span>
              </div>
            </div>
          )}

          {hasDcAta === false && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50 rounded-lg p-2.5">
              No DC token account yet. One will be created automatically — costs ~0.002 SOL for account rent.
            </p>
          )}

          {error && <p className="text-sm text-rose-500">{error}</p>}

          {status === "idle" || status === "error" ? (
            <button
              onClick={handleMint}
              disabled={dcVal <= 0 || (hntBalance != null && hntNeeded != null && hntBalance < hntNeeded)}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Mint {dcVal.toLocaleString()} DC
            </button>
          ) : status === "done" ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">DC minted!</p>
            </div>
          ) : (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
              <p className="text-sm text-sky-600 dark:text-sky-400">
                {status === "building" ? "Building transaction..." :
                 status === "signing" ? "Waiting for wallet signature..." :
                 "Confirming on Solana..."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
