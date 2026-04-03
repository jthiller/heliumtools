import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import Header from "../components/Header.jsx";
import {
  buildMintTransaction,
  buildDelegateTransaction,
  fetchHntPrice,
  resolveOui,
  resolvePayerKey,
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
// Resolved target card (shared between OUI and payer key resolution)
// ---------------------------------------------------------------------------

function ResolvedTargetCard({ data }) {
  if (!data) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-inset p-3 text-xs space-y-1.5">
      {data.name && (
        <div className="flex justify-between">
          <span className="text-content-tertiary">Name</span>
          <span className="font-medium text-content-primary">{data.name}</span>
        </div>
      )}
      {data.subnet && (
        <div className="flex justify-between">
          <span className="text-content-tertiary">Network</span>
          <span className="font-mono text-content-secondary uppercase">{data.subnet}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-content-tertiary">Payer</span>
        <span className="font-mono text-content-secondary">{truncateString(data.payer, 8, 4)}</span>
      </div>
      {data.escrow && (
        <div className="flex justify-between">
          <span className="text-content-tertiary">Escrow</span>
          <span className="font-mono text-content-secondary">{truncateString(data.escrow, 8, 4)}</span>
        </div>
      )}
      {data.balance != null && (
        <div className="flex justify-between">
          <span className="text-content-tertiary">Escrow Balance</span>
          <span className="font-mono text-content-secondary">
            {Number(data.balance).toLocaleString()} DC
            <span className="text-content-tertiary ml-1">(~${(Number(data.balance) / 100000).toFixed(2)})</span>
          </span>
        </div>
      )}
      {!data.escrow && !data.balance && (
        <p className="text-content-tertiary italic">New delegation — no existing escrow</p>
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

  const [inputMode, setInputMode] = useState("hnt");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState("idle");
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
        const dcAmount = parseInt(amount, 10);
        if (!Number.isInteger(dcAmount) || dcAmount <= 0) throw new Error("DC amount must be a positive whole number");
        params.dc_amount = dcAmount;
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

      {/* Wallet balance — show placeholder when disconnected */}
      <div className="rounded-lg bg-surface-inset px-3 py-2 text-xs">
        <p className="text-[10px] uppercase tracking-wider text-content-tertiary mb-1">Wallet balance</p>
        {connected ? (
          <div className="flex gap-4 text-content-secondary font-mono">
            <span>{hntBalance != null ? hntBalance.toFixed(4) : "..."} HNT</span>
            <span>{dcBalance != null ? dcBalance.toLocaleString() : "..."} DC</span>
          </div>
        ) : (
          <p className="text-content-tertiary">Connect wallet to view balance</p>
        )}
      </div>

      {connected && hasHntAta === false && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50 rounded-lg p-2.5">
          No HNT token account found. You need HNT in your wallet to mint Data Credits.
        </p>
      )}

      {connected && hasDcAta === false && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50 rounded-lg p-2.5">
          No DC token account yet. One will be created automatically when you mint — this costs a small amount of SOL (~0.002) for account rent.
        </p>
      )}

      {/* Input mode toggle */}
      <div className="flex gap-1 rounded-lg bg-surface-inset p-1">
        <button onClick={() => { setInputMode("hnt"); setAmount(""); }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${inputMode === "hnt" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
          Specify HNT
        </button>
        <button onClick={() => { setInputMode("dc"); setAmount(""); }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${inputMode === "dc" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
          Specify DC
        </button>
      </div>

      {/* Amount input */}
      <div>
        <label className="block text-xs font-medium text-content-secondary">
          {inputMode === "hnt" ? "HNT to burn" : "DC to mint"}
        </label>
        <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder={inputMode === "hnt" ? "e.g. 0.5" : "e.g. 100000"} className={INPUT_CLASS + " mt-1"} />
        {hntPrice && amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
          <p className="mt-1 text-[11px] text-content-tertiary font-mono">
            {inputMode === "hnt"
              ? `= ${Math.round(parseFloat(amount) * hntPrice.dc_per_hnt).toLocaleString()} DC (~$${(parseFloat(amount) * hntPrice.hnt_usd).toFixed(2)})`
              : `= ${hntPrice.dc_per_hnt > 0 ? (parseFloat(amount) / hntPrice.dc_per_hnt).toFixed(4) : "?"} HNT (~$${(parseFloat(amount) / 100000).toFixed(2)})`}
          </p>
        )}
      </div>

      {hntPrice && <ConversionPreview hntPrice={hntPrice} inputMode={inputMode} amount={amount} />}

      {/* Recipient */}
      <div>
        <label className="block text-xs font-medium text-content-secondary">
          Recipient (optional — defaults to your wallet)
        </label>
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)}
          placeholder={connected && walletPubkey ? truncateString(walletPubkey.toBase58(), 12, 6) : "Connect wallet"}
          className={INPUT_CLASS + " mt-1"} />
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {status === "idle" || status === "error" ? (
        <button onClick={handleMint}
          disabled={!connected || !amount || (inputMode === "hnt" ? !Number.isFinite(parseFloat(amount)) || parseFloat(amount) <= 0 : !/^\d+$/.test(amount) || parseInt(amount, 10) <= 0)}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {!connected ? "Connect Wallet to Mint" : "Mint Data Credits"}
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
            className="w-full text-xs text-content-tertiary hover:text-content-secondary">Mint more</button>
        </div>
      ) : (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
          <p className="text-sm text-sky-600 dark:text-sky-400">
            {status === "building" ? "Building transaction..." : status === "signing" ? "Waiting for wallet signature..." : "Confirming on Solana..."}
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delegate Tab
// ---------------------------------------------------------------------------

function DelegateTab({ hntPrice, onBalanceChange }) {
  const { connected, publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [targetInput, setTargetInput] = useState("");
  const [resolvedTarget, setResolvedTarget] = useState(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [inputMode, setInputMode] = useState("hnt"); // "hnt" | "dc" (delegate existing DC)
  const [burnMode, setBurnMode] = useState("dc_target"); // "dc_target" | "hnt_burn" (within hnt mode)
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);

  // Auto-detect: numeric = OUI, long base58 = payer key
  // Auto-detect: small number = OUI, long non-numeric string = payer key
  const trimmedTarget = targetInput.trim();
  const numericTarget = /^\d+$/.test(trimmedTarget) ? parseInt(trimmedTarget, 10) : null;
  const isPayerKey = trimmedTarget.length >= 32 && (numericTarget === null || numericTarget > 10000);

  // Debounced resolution
  useEffect(() => {
    const trimmed = targetInput.trim();
    if (!trimmed) { setResolvedTarget(null); setTargetLoading(false); return; }
    setResolvedTarget(null);
    setTargetLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        let data;
        if (isPayerKey) {
          data = await resolvePayerKey(trimmed);
        } else {
          const oui = parseInt(trimmed, 10);
          if (!oui || oui <= 0) { setTargetLoading(false); return; }
          const ouiData = await resolveOui(oui);
          if (ouiData) {
            // Normalize OUI response to match payer resolution shape
            data = {
              payer: ouiData.payer,
              escrow: ouiData.escrow,
              balance: ouiData.escrowDcBalance ? Number(ouiData.escrowDcBalance) : null,
              subnet: "iot",
              name: null, // OUI resolver doesn't return names — will be enriched by well-known
              oui: oui,
            };
            // Try to get well-known name
            try {
              const payerData = await resolvePayerKey(ouiData.payer);
              if (payerData?.name) data.name = payerData.name;
              if (payerData?.subnet) data.subnet = payerData.subnet;
            } catch { /* best effort */ }
          }
        }
        if (!cancelled) { setResolvedTarget(data); setTargetLoading(false); }
      } catch {
        if (!cancelled) { setResolvedTarget(null); setTargetLoading(false); }
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [targetInput, isPayerKey]);

  const handleDelegate = async () => {
    if (!walletPubkey || !sendTransaction || !resolvedTarget) return;
    setError(null);
    setStatus("building");
    try {
      const params = { owner: walletPubkey.toBase58(), subnet: resolvedTarget.subnet || "iot" };

      if (isPayerKey) {
        params.payer_key = targetInput.trim();
      } else {
        params.oui = parseInt(targetInput, 10);
      }

      if (inputMode === "hnt" && burnMode === "dc_target") {
        // Exact DC target: on-chain program determines HNT to burn
        const dcTarget = parseInt(amount, 10);
        if (!Number.isInteger(dcTarget) || dcTarget <= 0) throw new Error("DC amount must be a positive integer");
        params.amount = dcTarget;
        params.mint_dc = true;
      } else if (inputMode === "hnt" && burnMode === "hnt_burn") {
        // HNT amount: estimate DC for the delegate instruction
        const hntVal = parseFloat(amount);
        if (!hntPrice?.dc_per_hnt) throw new Error("HNT price not available");
        params.hnt_amount = hntVal;
        params.amount = Math.round(hntVal * hntPrice.dc_per_hnt);
      } else {
        // Delegate existing DC
        params.amount = parseInt(amount, 10);
      }

      const result = await buildDelegateTransaction(params);
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

  const amountValid = inputMode === "hnt" && burnMode === "hnt_burn"
    ? amount && Number.isFinite(parseFloat(amount)) && parseFloat(amount) > 0
    : amount && /^\d+$/.test(amount) && parseInt(amount, 10) > 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-center">
        <WalletMultiButton />
      </div>

      {/* OUI or Payer Key input */}
      <div>
        <label className="block text-xs font-medium text-content-secondary">OUI Number or Payer Key</label>
        <input type="text" value={targetInput} onChange={(e) => setTargetInput(e.target.value)}
          placeholder="e.g. 1 or 112qB3YaH5bZ..." className={INPUT_CLASS + " mt-1"} />
        {targetInput && (
          <p className="mt-0.5 text-[10px] text-content-tertiary">
            {isPayerKey ? "Detected: payer key" : "Detected: OUI number"}
          </p>
        )}
      </div>

      {/* Resolution result */}
      {targetLoading && <p className="text-xs text-content-tertiary">Resolving...</p>}
      <ResolvedTargetCard data={resolvedTarget} />
      {targetInput && !targetLoading && !resolvedTarget && (
        <p className="text-xs text-rose-500">{isPayerKey ? "Could not resolve payer key" : "OUI not found"}</p>
      )}

      {/* Primary mode toggle */}
      <div className="flex gap-1 rounded-lg bg-surface-inset p-1">
        <button onClick={() => { setInputMode("hnt"); setAmount(""); }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${inputMode === "hnt" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
          Burn HNT → Delegate
        </button>
        <button onClick={() => { setInputMode("dc"); setAmount(""); }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${inputMode === "dc" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
          Delegate Existing DC
        </button>
      </div>

      {/* Secondary toggle: when burning HNT, specify by DC target or HNT amount */}
      {inputMode === "hnt" && (
        <div className="flex gap-1 rounded-lg bg-surface-inset p-1">
          <button onClick={() => { setBurnMode("dc_target"); setAmount(""); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${burnMode === "dc_target" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
            Specify DC to deliver
          </button>
          <button onClick={() => { setBurnMode("hnt_burn"); setAmount(""); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${burnMode === "hnt_burn" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
            Specify HNT to burn
          </button>
        </div>
      )}

      {/* Amount input */}
      <div>
        <label className="block text-xs font-medium text-content-secondary">
          {inputMode === "dc" ? "DC to delegate" :
           burnMode === "dc_target" ? "DC to deliver" : "HNT to burn"}
        </label>
        <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder={inputMode === "dc" ? "e.g. 100000" :
            burnMode === "dc_target" ? "e.g. 100000" : "e.g. 0.5"}
          className={INPUT_CLASS + " mt-1"} />
        {/* Inline conversion hints */}
        {inputMode === "dc" && amount && parseInt(amount, 10) > 0 && (
          <p className="mt-1 text-[10px] text-content-tertiary font-mono">~${(parseInt(amount, 10) / 100000).toFixed(2)} USD</p>
        )}
        {inputMode === "hnt" && burnMode === "dc_target" && hntPrice && amount && parseInt(amount, 10) > 0 && (
          <p className="mt-1 text-[11px] text-content-tertiary font-mono">
            burns ~{hntPrice.dc_per_hnt > 0 ? (parseInt(amount, 10) / hntPrice.dc_per_hnt).toFixed(4) : "?"} HNT (~${(parseInt(amount, 10) / 100000).toFixed(2)})
          </p>
        )}
        {inputMode === "hnt" && burnMode === "hnt_burn" && hntPrice && amount && parseFloat(amount) > 0 && (
          <p className="mt-1 text-[11px] text-content-tertiary font-mono">
            = {Math.round(parseFloat(amount) * hntPrice.dc_per_hnt).toLocaleString()} DC (~${(parseFloat(amount) * hntPrice.hnt_usd).toFixed(2)})
          </p>
        )}
      </div>

      {inputMode === "hnt" && hntPrice && (
        <ConversionPreview hntPrice={hntPrice}
          inputMode={burnMode === "dc_target" ? "dc" : "hnt"} amount={amount} />
      )}

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {status === "idle" || status === "error" ? (
        <button onClick={handleDelegate}
          disabled={!connected || !resolvedTarget || !amountValid}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {!connected ? "Connect Wallet" : inputMode === "hnt" ? "Burn HNT & Delegate" : `Delegate ${resolvedTarget?.name ? `to ${resolvedTarget.name}` : ""}`}
        </button>
      ) : status === "done" ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {inputMode === "hnt" ? "HNT burned and DC delegated!" : "DC delegated successfully!"}
            </p>
            {txSignature && (
              <a href={`https://solscan.io/tx/${txSignature}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-accent hover:underline">View on Solscan</a>
            )}
          </div>
          <button onClick={() => { setStatus("idle"); setAmount(""); setTxSignature(null); }}
            className="w-full text-xs text-content-tertiary hover:text-content-secondary">Delegate more</button>
        </div>
      ) : (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
          <p className="text-sm text-sky-600 dark:text-sky-400">
            {status === "building" ? "Building transaction..." : status === "signing" ? "Waiting for wallet signature..." : "Confirming on Solana..."}
          </p>
        </div>
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
  const [tab, setTab] = useState("mint");
  const [hntPrice, setHntPrice] = useState(null);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);

  // Shared wallet balances
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

        <div className="mt-6 flex gap-1 rounded-lg bg-surface-inset p-1">
          <button onClick={() => setTab("mint")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "mint" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
            Mint DC
          </button>
          <button onClick={() => setTab("delegate")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "delegate" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
            Delegate to OUI
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-6">
          {tab === "mint"
            ? <MintTab hntPrice={hntPrice} hntBalance={hntBalance} dcBalance={dcBalance}
                hasHntAta={hasHntAta} hasDcAta={hasDcAta} onBalanceChange={refreshBalances} />
            : <DelegateTab hntPrice={hntPrice} onBalanceChange={refreshBalances} />}
        </div>
      </main>
    </div>
  );
}
