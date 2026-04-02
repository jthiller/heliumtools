import { useState, useEffect, useMemo, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";
import Header from "../components/Header.jsx";
import {
  buildMintTransaction,
  buildDelegateTransaction,
  fetchHntPrice,
  resolveOui,
} from "../lib/dcMintApi.js";
import { truncateString } from "../lib/utils.js";

const HNT_MINT = new PublicKey("hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux");
const DC_MINT = new PublicKey("dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm");

// ---------------------------------------------------------------------------
// Conversion Preview
// ---------------------------------------------------------------------------

function ConversionPreview({ hntPrice, inputMode, amount }) {
  if (!hntPrice || !amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return null;
  }

  const val = parseFloat(amount);
  let hntVal, dcVal, usdVal;
  if (inputMode === "hnt") {
    hntVal = val;
    usdVal = val * hntPrice.hnt_usd;
    dcVal = Math.round(val * hntPrice.dc_per_hnt);
  } else {
    dcVal = val;
    usdVal = val / hntPrice.dc_per_usd;
    hntVal = val / hntPrice.dc_per_hnt;
  }

  return (
    <div className="rounded-lg border border-border bg-surface-inset p-3 text-xs space-y-1">
      <div className="flex justify-between text-content-secondary">
        <span>You burn</span>
        <span className="font-mono">{hntVal < 0.001 ? hntVal.toExponential(2) : hntVal.toFixed(4)} HNT (~${usdVal.toFixed(2)})</span>
      </div>
      <div className="flex justify-between font-medium text-content-primary">
        <span>You receive</span>
        <span className="font-mono">{Math.round(dcVal).toLocaleString()} DC</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mint Tab
// ---------------------------------------------------------------------------

function MintTab({ hntPrice }) {
  const { connected, publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [inputMode, setInputMode] = useState("hnt"); // "hnt" | "dc"
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("idle"); // idle | building | signing | confirming | done | error
  const [error, setError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);

  // Balances
  const [hntBalance, setHntBalance] = useState(null);
  const [dcBalance, setDcBalance] = useState(null);

  useEffect(() => {
    if (!connected || !walletPubkey || !connection) return;
    let cancelled = false;
    async function fetch() {
      try {
        const [hntAccounts, dcAccounts] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: HNT_MINT }),
          connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: DC_MINT }),
        ]);
        if (cancelled) return;
        const hntAcc = hntAccounts.value[0];
        setHntBalance(hntAcc ? Number(hntAcc.account.data.parsed.info.tokenAmount.uiAmount) : 0);
        const dcAcc = dcAccounts.value[0];
        setDcBalance(dcAcc ? Number(dcAcc.account.data.parsed.info.tokenAmount.amount) : 0);
      } catch {
        if (!cancelled) { setHntBalance(null); setDcBalance(null); }
      }
    }
    fetch();
    return () => { cancelled = true; };
  }, [connected, walletPubkey, connection, status === "done"]);

  const handleMint = async () => {
    if (!walletPubkey || !sendTransaction || !amount) return;
    setError(null);
    setStatus("building");
    try {
      const params = { owner: walletPubkey.toBase58() };
      if (inputMode === "hnt") {
        params.hnt_amount = parseFloat(amount);
      } else {
        params.dc_amount = parseInt(amount, 10);
      }
      if (recipient.trim()) params.recipient = recipient.trim();

      const result = await buildMintTransaction(params);
      setStatus("signing");

      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      const sig = await sendTransaction(txn, connection);
      setStatus("confirming");
      await connection.confirmTransaction(sig, "confirmed");
      setTxSignature(sig);
      setStatus("done");
    } catch (err) {
      console.error("Mint failed:", err);
      setError(err.message);
      setStatus("error");
    }
  };

  const inputClass = "w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content-primary placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <WalletMultiButton />
      </div>

      {connected && walletPubkey && (
        <>
          {/* Balance display */}
          <div className="flex gap-4 text-xs text-content-secondary">
            <span>HNT: <span className="font-mono">{hntBalance != null ? hntBalance.toFixed(4) : "..."}</span></span>
            <span>DC: <span className="font-mono">{dcBalance != null ? dcBalance.toLocaleString() : "..."}</span></span>
          </div>

          {/* Input mode toggle */}
          <div className="flex gap-1 rounded-lg bg-surface-inset p-1">
            <button
              onClick={() => { setInputMode("hnt"); setAmount(""); }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                inputMode === "hnt"
                  ? "bg-surface-raised text-content-primary shadow-sm"
                  : "text-content-tertiary hover:text-content-secondary"
              }`}
            >
              Specify HNT
            </button>
            <button
              onClick={() => { setInputMode("dc"); setAmount(""); }}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                inputMode === "dc"
                  ? "bg-surface-raised text-content-primary shadow-sm"
                  : "text-content-tertiary hover:text-content-secondary"
              }`}
            >
              Specify DC
            </button>
          </div>

          {/* Amount input */}
          <div>
            <label className="block text-xs font-medium text-content-secondary">
              {inputMode === "hnt" ? "HNT to burn" : "DC to mint"}
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={inputMode === "hnt" ? "e.g. 0.5" : "e.g. 100000"}
              className={inputClass + " mt-1"}
            />
          </div>

          {/* Conversion preview */}
          {hntPrice && <ConversionPreview hntPrice={hntPrice} inputMode={inputMode} amount={amount} />}

          {/* HNT price info */}
          {hntPrice && (
            <p className="text-[10px] text-content-tertiary text-center">
              1 HNT = {hntPrice.dc_per_hnt.toLocaleString()} DC | HNT ${hntPrice.hnt_usd}
            </p>
          )}

          {/* Recipient (optional) */}
          <div>
            <label className="block text-xs font-medium text-content-secondary">
              Recipient (optional — defaults to your wallet)
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={truncateString(walletPubkey.toBase58(), 12, 6)}
              className={inputClass + " mt-1"}
            />
          </div>

          {error && <p className="text-sm text-rose-500">{error}</p>}

          {status === "idle" || status === "error" ? (
            <button
              onClick={handleMint}
              disabled={!amount || parseFloat(amount) <= 0}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Mint Data Credits
            </button>
          ) : status === "done" ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">DC minted successfully!</p>
                {txSignature && (
                  <a href={`https://solscan.io/tx/${txSignature}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline">View on Solscan</a>
                )}
              </div>
              <button onClick={() => { setStatus("idle"); setAmount(""); setTxSignature(null); }}
                className="w-full text-xs text-content-tertiary hover:text-content-secondary">
                Mint more
              </button>
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
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delegate Tab
// ---------------------------------------------------------------------------

function DelegateTab() {
  const { connected, publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [ouiInput, setOuiInput] = useState("");
  const [ouiData, setOuiData] = useState(null);
  const [ouiLoading, setOuiLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);

  // Debounced OUI lookup
  useEffect(() => {
    const oui = parseInt(ouiInput, 10);
    if (!oui || oui <= 0) { setOuiData(null); return; }
    setOuiLoading(true);
    const timer = setTimeout(async () => {
      const data = await resolveOui(oui);
      setOuiData(data);
      setOuiLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [ouiInput]);

  const handleDelegate = async () => {
    if (!walletPubkey || !sendTransaction || !ouiData || !amount) return;
    setError(null);
    setStatus("building");
    try {
      const result = await buildDelegateTransaction({
        owner: walletPubkey.toBase58(),
        amount: parseInt(amount, 10),
        oui: parseInt(ouiInput, 10),
      });
      setStatus("signing");

      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      const sig = await sendTransaction(txn, connection);
      setStatus("confirming");
      await connection.confirmTransaction(sig, "confirmed");
      setTxSignature(sig);
      setStatus("done");
    } catch (err) {
      console.error("Delegate failed:", err);
      setError(err.message);
      setStatus("error");
    }
  };

  const inputClass = "w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content-primary placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <WalletMultiButton />
      </div>

      {connected && walletPubkey && (
        <>
          {/* OUI input */}
          <div>
            <label className="block text-xs font-medium text-content-secondary">OUI Number</label>
            <input
              type="text"
              value={ouiInput}
              onChange={(e) => setOuiInput(e.target.value)}
              placeholder="e.g. 1"
              className={inputClass + " mt-1"}
            />
          </div>

          {/* OUI details card */}
          {ouiLoading && <p className="text-xs text-content-tertiary">Looking up OUI...</p>}
          {ouiData && (
            <div className="rounded-lg border border-border bg-surface-inset p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-content-tertiary">Payer</span>
                <span className="font-mono text-content-secondary">{truncateString(ouiData.payer, 8, 4)}</span>
              </div>
              {ouiData.escrow && (
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Escrow</span>
                  <span className="font-mono text-content-secondary">{truncateString(ouiData.escrow, 8, 4)}</span>
                </div>
              )}
              {ouiData.dc_balance != null && (
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Current DC Balance</span>
                  <span className="font-mono text-content-secondary">{Number(ouiData.dc_balance).toLocaleString()} DC</span>
                </div>
              )}
            </div>
          )}
          {ouiInput && !ouiLoading && !ouiData && (
            <p className="text-xs text-rose-500">OUI not found</p>
          )}

          {/* DC amount */}
          <div>
            <label className="block text-xs font-medium text-content-secondary">DC to Delegate</label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 100000"
              className={inputClass + " mt-1"}
            />
          </div>

          {error && <p className="text-sm text-rose-500">{error}</p>}

          {status === "idle" || status === "error" ? (
            <button
              onClick={handleDelegate}
              disabled={!ouiData || !amount || parseInt(amount, 10) <= 0}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Delegate to OUI {ouiInput}
            </button>
          ) : status === "done" ? (
            <div className="space-y-2">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">DC delegated successfully!</p>
                {txSignature && (
                  <a href={`https://solscan.io/tx/${txSignature}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline">View on Solscan</a>
                )}
              </div>
              <button onClick={() => { setStatus("idle"); setAmount(""); setTxSignature(null); }}
                className="w-full text-xs text-content-tertiary hover:text-content-secondary">
                Delegate more
              </button>
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
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function DcMintTool() {
  const [tab, setTab] = useState("mint"); // "mint" | "delegate"
  const [hntPrice, setHntPrice] = useState(null);

  useEffect(() => {
    fetchHntPrice().then(setHntPrice).catch(() => {});
    const interval = setInterval(() => {
      fetchHntPrice().then(setHntPrice).catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-surface text-content-primary">
      <Header breadcrumb="Mint Data Credits" />
      <main className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-2xl font-bold">Mint Data Credits</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Convert HNT to Data Credits using your Solana wallet. Mint to your wallet or delegate directly to an OUI.
        </p>

        {/* Tab switcher */}
        <div className="mt-6 flex gap-1 rounded-lg bg-surface-inset p-1">
          <button
            onClick={() => setTab("mint")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "mint"
                ? "bg-surface-raised text-content-primary shadow-sm"
                : "text-content-tertiary hover:text-content-secondary"
            }`}
          >
            Mint DC
          </button>
          <button
            onClick={() => setTab("delegate")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === "delegate"
                ? "bg-surface-raised text-content-primary shadow-sm"
                : "text-content-tertiary hover:text-content-secondary"
            }`}
          >
            Delegate to OUI
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-6">
          {tab === "mint" ? <MintTab hntPrice={hntPrice} /> : <DelegateTab />}
        </div>
      </main>
    </div>
  );
}
