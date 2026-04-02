import { useState, useEffect, useMemo, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import Header from "../components/Header.jsx";
import {
  buildMintTransaction,
  buildDelegateTransaction,
  fetchHntPrice,
  resolveOui,
} from "../lib/dcMintApi.js";
import { truncateString } from "../lib/utils.js";
import { HNT_MINT, DC_MINT } from "./constants.js";

const INPUT_CLASS = "w-full rounded-lg border border-border bg-surface-inset px-3 py-2 font-mono text-sm text-content-primary placeholder:text-content-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

// ---------------------------------------------------------------------------
// Conversion Preview
// ---------------------------------------------------------------------------

function ConversionPreview({ hntPrice, inputMode, amount }) {
  if (!hntPrice) return null;

  const hasAmount = amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0;
  const val = hasAmount ? parseFloat(amount) : 0;

  let hntVal, dcVal, usdVal;
  if (inputMode === "hnt") {
    hntVal = val;
    usdVal = val * hntPrice.hnt_usd;
    dcVal = Math.round(val * hntPrice.dc_per_hnt);
  } else {
    dcVal = val;
    usdVal = val / hntPrice.dc_per_usd;
    hntVal = hntPrice.dc_per_hnt > 0 ? val / hntPrice.dc_per_hnt : 0;
  }

  return (
    <div className="rounded-lg border border-border bg-surface-inset p-3 text-xs space-y-1.5">
      <div className="flex justify-between text-content-secondary">
        <span>Exchange rate</span>
        <span className="font-mono">1 HNT = {hntPrice.dc_per_hnt.toLocaleString()} DC</span>
      </div>
      <div className="flex justify-between text-content-secondary">
        <span>HNT price</span>
        <span className="font-mono">${hntPrice.hnt_usd}</span>
      </div>
      {hasAmount && (
        <>
          <div className="border-t border-border-muted pt-1.5 flex justify-between text-content-secondary">
            <span>You burn</span>
            <span className="font-mono">{hntVal < 0.001 ? hntVal.toExponential(2) : hntVal.toFixed(4)} HNT (~${usdVal.toFixed(2)})</span>
          </div>
          <div className="flex justify-between font-medium text-content-primary">
            <span>You receive</span>
            <span className="font-mono">{Math.round(dcVal).toLocaleString()} DC (~${(dcVal / 100000).toFixed(2)})</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mint Tab
// ---------------------------------------------------------------------------

function MintTab({ hntPrice, hntBalance, dcBalance, hasHntAta, hasDcAta, onBalanceChange }) {
  const { connected, publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [inputMode, setInputMode] = useState("hnt"); // "hnt" | "dc"
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("idle"); // idle | building | signing | confirming | done | error
  const [error, setError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);

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
      onBalanceChange?.();
    } catch (err) {
      console.error("Mint failed:", err);
      setError(err.message);
      setStatus("error");
    }
  };


  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <WalletMultiButton />
      </div>

      {connected && walletPubkey && (
        <>
          {/* Wallet balance */}
          <div className="rounded-lg bg-surface-inset px-3 py-2 text-xs">
            <p className="text-[10px] uppercase tracking-wider text-content-tertiary mb-1">Wallet balance</p>
            <div className="flex gap-4 text-content-secondary font-mono">
              <span>{hntBalance != null ? hntBalance.toFixed(4) : "..."} HNT</span>
              <span>{dcBalance != null ? dcBalance.toLocaleString() : "..."} DC</span>
            </div>
          </div>

          {hasHntAta === false && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50 rounded-lg p-2.5">
              No HNT token account found. You need HNT in your wallet to mint Data Credits.
            </p>
          )}

          {hasDcAta === false && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50 rounded-lg p-2.5">
              No DC token account yet. One will be created automatically when you mint — this costs a small amount of SOL (~0.002) for account rent.
            </p>
          )}

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

          {/* Amount input with inline conversion hint */}
          <div>
            <label className="block text-xs font-medium text-content-secondary">
              {inputMode === "hnt" ? "HNT to burn" : "DC to mint"}
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={inputMode === "hnt" ? "e.g. 0.5" : "e.g. 100000"}
              className={INPUT_CLASS + " mt-1"}
            />
            {hntPrice && amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
              <p className="mt-1 text-[11px] text-content-tertiary font-mono">
                {inputMode === "hnt"
                  ? `= ${Math.round(parseFloat(amount) * hntPrice.dc_per_hnt).toLocaleString()} DC (~$${(parseFloat(amount) * hntPrice.hnt_usd).toFixed(2)})`
                  : `= ${hntPrice.dc_per_hnt > 0 ? (parseFloat(amount) / hntPrice.dc_per_hnt).toFixed(4) : "?"} HNT (~$${(parseFloat(amount) / 100000).toFixed(2)})`
                }
              </p>
            )}
          </div>

          {/* Conversion preview */}
          {hntPrice && <ConversionPreview hntPrice={hntPrice} inputMode={inputMode} amount={amount} />}

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
              className={INPUT_CLASS + " mt-1"}
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

function DelegateTab({ onBalanceChange }) {
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
    if (!oui || isNaN(oui) || oui <= 0) { setOuiData(null); setOuiLoading(false); return; }
    setOuiLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const data = await resolveOui(oui);
        if (!cancelled) { setOuiData(data); setOuiLoading(false); }
      } catch {
        if (!cancelled) { setOuiData(null); setOuiLoading(false); }
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
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
      onBalanceChange?.();
    } catch (err) {
      console.error("Delegate failed:", err);
      setError(err.message);
      setStatus("error");
    }
  };


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
              className={INPUT_CLASS + " mt-1"}
            />
          </div>

          {/* OUI details card */}
          {ouiLoading && <p className="text-xs text-content-tertiary">Looking up OUI...</p>}
          {ouiData && (
            <div className="rounded-lg border border-border bg-surface-inset p-3 text-xs space-y-1.5">
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
              {ouiData.escrowDcBalance != null && (
                <div className="flex justify-between">
                  <span className="text-content-tertiary">Escrow Balance</span>
                  <span className="font-mono text-content-secondary">
                    {Number(ouiData.escrowDcBalance).toLocaleString()} DC
                    <span className="text-content-tertiary ml-1">(~${(Number(ouiData.escrowDcBalance) / 100000).toFixed(2)})</span>
                  </span>
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
              className={INPUT_CLASS + " mt-1"}
            />
            {amount && parseInt(amount, 10) > 0 && (
              <p className="mt-1 text-[10px] text-content-tertiary font-mono">
                ~${(parseInt(amount, 10) / 100000).toFixed(2)} USD
              </p>
            )}
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
  const { connected, publicKey: walletPubkey } = useWallet();
  const { connection } = useConnection();
  const [tab, setTab] = useState("mint"); // "mint" | "delegate"
  const [hntPrice, setHntPrice] = useState(null);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

  // Shared wallet balances — lifted here so tab switching doesn't refetch
  const [hntBalance, setHntBalance] = useState(null);
  const [dcBalance, setDcBalance] = useState(null);
  const [hasHntAta, setHasHntAta] = useState(null);
  const [hasDcAta, setHasDcAta] = useState(null);

  useEffect(() => {
    if (!connected || !walletPubkey || !connection) return;
    let cancelled = false;
    async function fetchBal() {
      try {
        const [hntAccounts, dcAccounts] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: HNT_MINT }),
          connection.getParsedTokenAccountsByOwner(walletPubkey, { mint: DC_MINT }),
        ]);
        if (cancelled) return;
        const hntAcc = hntAccounts.value[0];
        setHasHntAta(!!hntAcc);
        setHntBalance(hntAcc ? Number(hntAcc.account.data.parsed.info.tokenAmount.uiAmount) : 0);
        const dcAcc = dcAccounts.value[0];
        setHasDcAta(!!dcAcc);
        setDcBalance(dcAcc ? Number(dcAcc.account.data.parsed.info.tokenAmount.amount) : 0);
      } catch {
        if (!cancelled) { setHntBalance(null); setDcBalance(null); }
      }
    }
    fetchBal();
    return () => { cancelled = true; };
  }, [connected, walletPubkey, connection, balanceRefreshKey]);

  const refreshBalances = useCallback(() => setBalanceRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const updatePrice = () =>
      fetchHntPrice()
        .then((data) => setHntPrice((prev) =>
          prev && prev.hnt_usd === data.hnt_usd && prev.dc_per_hnt === data.dc_per_hnt ? prev : data
        ))
        .catch(() => {});
    updatePrice();
    const interval = setInterval(updatePrice, 30_000);
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
          {tab === "mint"
            ? <MintTab hntPrice={hntPrice} hntBalance={hntBalance} dcBalance={dcBalance}
                hasHntAta={hasHntAta} hasDcAta={hasDcAta} onBalanceChange={refreshBalances} />
            : <DelegateTab onBalanceChange={refreshBalances} />}
        </div>
      </main>
    </div>
  );
}
