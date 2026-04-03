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
import { confirmAndVerify, cleanInt, cleanDecimal } from "./solanaUtils.js";

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
      {hasAmount ? (
        <>
          <div className="flex justify-between text-content-secondary">
            <span>You burn</span>
            <span className="font-mono">{hntVal < 0.001 ? hntVal.toExponential(2) : hntVal.toFixed(4)} HNT (~${usdVal.toFixed(2)})</span>
          </div>
          <div className="flex justify-between font-medium text-content-primary">
            <span>You receive</span>
            <span className="font-mono">{Math.round(dcVal).toLocaleString()} DC (~${(dcVal / 100000).toFixed(2)})</span>
          </div>
          <div className="border-t border-border-muted pt-1 text-[10px] text-content-tertiary text-center font-mono">
            1 HNT = {hntPrice.dc_per_hnt.toLocaleString()} DC · HNT ${hntPrice.hnt_usd}
          </div>
        </>
      ) : (
        <>
          <div className="flex justify-between text-content-secondary">
            <span>Exchange rate</span>
            <span className="font-mono">1 HNT = {hntPrice.dc_per_hnt.toLocaleString()} DC</span>
          </div>
          <div className="flex justify-between text-content-secondary">
            <span>HNT price</span>
            <span className="font-mono">${hntPrice.hnt_usd}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolved target card (shared between OUI and payer key resolution)
// ---------------------------------------------------------------------------

function SubnetEscrowRow({ label, info, selected, onSelect }) {
  if (!info) return null;
  return (
    <button onClick={onSelect}
      className={`w-full text-left rounded-md p-2 text-xs transition-colors ${selected ? "bg-accent/10 border border-accent/30" : "hover:bg-surface-raised"}`}>
      <div className="flex justify-between items-center">
        <span className="font-mono uppercase font-medium">{label}</span>
        <span className="font-mono text-content-secondary">
          {Number(info.balance).toLocaleString()} DC
          <span className="text-content-tertiary ml-1">(~${(Number(info.balance) / 100000).toFixed(2)})</span>
        </span>
      </div>
      <p className="font-mono text-[10px] text-content-tertiary mt-0.5">{truncateString(info.escrow, 10, 4)}</p>
    </button>
  );
}

function ResolvedTargetCard({ data, selectedSubnet, onSelectSubnet }) {
  if (!data) return null;

  const hasSubnets = data.subnets;
  const iot = hasSubnets?.iot;
  const mobile = hasSubnets?.mobile;
  const bothExist = iot && mobile;
  const neitherExist = !iot && !mobile;

  return (
    <div className="rounded-lg border border-border bg-surface-inset p-3 text-xs space-y-1.5">
      {data.name && (
        <div className="flex justify-between">
          <span className="text-content-tertiary">Name</span>
          <span className="font-medium text-content-primary">{data.name}</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-content-tertiary">Payer</span>
        <span className="font-mono text-content-secondary">{truncateString(data.payer, 8, 4)}</span>
      </div>

      {/* Subnet escrow(s) */}
      {hasSubnets && !neitherExist && (
        <div className="space-y-1 pt-1">
          {bothExist && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400">
              Escrows found on both IoT and Mobile — select one:
            </p>
          )}
          <SubnetEscrowRow label="IoT" info={iot} selected={selectedSubnet === "iot"} onSelect={() => onSelectSubnet?.("iot")} />
          <SubnetEscrowRow label="Mobile" info={mobile} selected={selectedSubnet === "mobile"} onSelect={() => onSelectSubnet?.("mobile")} />
        </div>
      )}

      {/* No escrow found on either subnet */}
      {neitherExist && (
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
        const hntVal = parseFloat(amount);
        if (hntBalance != null && hntVal > hntBalance) {
          throw new Error(`Insufficient HNT. You have ${hntBalance.toFixed(4)} HNT.`);
        }
        params.hnt_amount = hntVal;
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
      await confirmAndVerify(connection, sig);
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
        <input type="text" value={amount}
          onChange={(e) => setAmount(inputMode === "hnt" ? cleanDecimal(e.target.value) : cleanInt(e.target.value))}
          placeholder={inputMode === "hnt" ? "e.g. 0.5" : "e.g. 100000"} className={INPUT_CLASS + " mt-1"} />
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

function DelegateTab({ hntPrice, dcBalance, hasDcAta, onBalanceChange }) {
  const { connected, publicKey: walletPubkey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [targetInput, setTargetInput] = useState("");
  const [resolvedTarget, setResolvedTarget] = useState(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [hasAttemptedResolve, setHasAttemptedResolve] = useState(false);
  const [selectedSubnet, setSelectedSubnet] = useState(null);
  const [inputMode, setInputMode] = useState("hnt"); // "hnt" | "dc" (delegate existing DC)
  const [burnMode, setBurnMode] = useState("dc_target"); // "dc_target" | "hnt_burn" (within hnt mode)
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [txSignature, setTxSignature] = useState(null);

  // Display hint (not used in effect — effect computes its own from the closure)
  const isPayerKey = targetInput.trim().length >= 32 && !/^\d+$/.test(targetInput.trim());

  // Debounced resolution
  useEffect(() => {
    const trimmed = targetInput.trim();
    if (!trimmed) { setResolvedTarget(null); setTargetLoading(false); setHasAttemptedResolve(false); return; }
    setResolvedTarget(null);
    setTargetLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // Detect inside closure to avoid stale render-scope value
        const isNumeric = /^\d+$/.test(trimmed);
        const isPayer = trimmed.length >= 32 && !isNumeric;

        let data;
        if (isPayer) {
          data = await resolvePayerKey(trimmed);
        } else {
          const oui = parseInt(trimmed, 10);
          if (!oui || oui <= 0) { setTargetLoading(false); setHasAttemptedResolve(true); return; }
          const ouiData = await resolveOui(oui);
          if (ouiData) {
            // OUIs are always IoT — normalize into the subnets shape
            const balance = ouiData.escrowDcBalance ? Number(ouiData.escrowDcBalance) : null;
            // Resolve well-known name via payer key lookup
            let name = null;
            try {
              const payerInfo = await resolvePayerKey(ouiData.payer);
              if (payerInfo?.name) name = payerInfo.name;
            } catch { /* best effort */ }
            data = {
              payer: ouiData.payer,
              name,
              oui: oui,
              subnets: {
                iot: ouiData.escrow ? { escrow: ouiData.escrow, balance: balance ?? 0 } : null,
                mobile: null,
              },
            };
          }
        }
        if (!cancelled) { setResolvedTarget(data); setTargetLoading(false); setHasAttemptedResolve(true); }
      } catch {
        if (!cancelled) { setResolvedTarget(null); setTargetLoading(false); setHasAttemptedResolve(true); }
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [targetInput]);

  // Auto-select subnet when resolution completes
  useEffect(() => {
    if (!resolvedTarget?.subnets) { setSelectedSubnet(null); return; }
    const { iot, mobile } = resolvedTarget.subnets;
    if (iot && !mobile) setSelectedSubnet("iot");
    else if (mobile && !iot) setSelectedSubnet("mobile");
    else if (!iot && !mobile) setSelectedSubnet("iot"); // default for new delegation
    else setSelectedSubnet(null); // both exist — user must choose
  }, [resolvedTarget]);

  const handleDelegate = async () => {
    if (!walletPubkey || !sendTransaction || !resolvedTarget || !selectedSubnet) return;
    setError(null);
    setStatus("building");
    try {
      const params = { owner: walletPubkey.toBase58(), subnet: selectedSubnet };

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
        // Apply 1% slippage buffer — on-chain oracle may differ from cached price
        const hntVal = parseFloat(amount);
        if (!hntPrice?.dc_per_hnt) throw new Error("HNT price not available");
        params.hnt_amount = hntVal;
        const estimatedDc = Math.round(hntVal * hntPrice.dc_per_hnt * 0.99);
        if (estimatedDc < 1) throw new Error("HNT amount too small — would produce less than 1 DC");
        params.amount = estimatedDc;
      } else {
        // Delegate existing DC
        const dcVal = parseInt(amount, 10);
        if (dcBalance != null && dcVal > dcBalance) {
          throw new Error(`Insufficient DC. You have ${dcBalance.toLocaleString()} DC.`);
        }
        params.amount = dcVal;
      }

      const result = await buildDelegateTransaction(params);
      setStatus("signing");
      const txn = VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64"));
      const sig = await sendTransaction(txn, connection);
      setStatus("confirming");
      await confirmAndVerify(connection, sig);
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

      {connected && inputMode === "dc" && hasDcAta === false && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/50 rounded-lg p-2.5">
          No DC token account found. Use "Burn HNT → Delegate" to mint and delegate in one step.
        </p>
      )}

      {connected && inputMode === "dc" && dcBalance != null && (
        <div className="rounded-lg bg-surface-inset px-3 py-2 text-xs">
          <span className="text-content-tertiary">Your DC: </span>
          <span className="font-mono text-content-secondary">{dcBalance.toLocaleString()}</span>
        </div>
      )}

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
      <ResolvedTargetCard data={resolvedTarget} selectedSubnet={selectedSubnet} onSelectSubnet={setSelectedSubnet} />
      {targetInput && !targetLoading && !resolvedTarget && hasAttemptedResolve && (
        <p className="text-xs text-rose-500">{isPayerKey ? "Could not resolve payer key" : "OUI not found"}</p>
      )}

      {/* Primary mode toggle */}
      <div className="flex gap-1 rounded-lg bg-surface-inset p-1">
        <button onClick={() => { setInputMode("hnt"); setBurnMode("dc_target"); setAmount(""); }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${inputMode === "hnt" ? "bg-surface-raised text-content-primary shadow-sm" : "text-content-tertiary hover:text-content-secondary"}`}>
          Burn HNT → Delegate
        </button>
        <button onClick={() => { setInputMode("dc"); setBurnMode("dc_target"); setAmount(""); }}
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
        <input type="text" value={amount}
          onChange={(e) => setAmount(inputMode === "hnt" && burnMode === "hnt_burn" ? cleanDecimal(e.target.value) : cleanInt(e.target.value))}
          placeholder={inputMode === "dc" ? "e.g. 100000" :
            burnMode === "dc_target" ? "e.g. 100000" : "e.g. 0.5"}
          className={INPUT_CLASS + " mt-1"} />
        {inputMode === "dc" && amount && parseInt(amount, 10) > 0 && (
          <p className="mt-1 text-[10px] text-content-tertiary font-mono">~${(parseInt(amount, 10) / 100000).toFixed(2)} USD</p>
        )}
      </div>

      {inputMode === "hnt" && hntPrice && (
        <ConversionPreview hntPrice={hntPrice}
          inputMode={burnMode === "dc_target" ? "dc" : "hnt"} amount={amount} />
      )}

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {status === "idle" || status === "error" ? (
        <button onClick={handleDelegate}
          disabled={!connected || !resolvedTarget || !selectedSubnet || !amountValid}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {!connected ? "Connect Wallet" : inputMode === "hnt" ? "Burn HNT & Delegate" : resolvedTarget?.name ? `Delegate to ${resolvedTarget.name}` : "Delegate"}
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
            : <DelegateTab hntPrice={hntPrice} dcBalance={dcBalance} hasDcAta={hasDcAta}
                onBalanceChange={refreshBalances} />}
        </div>
      </main>
    </div>
  );
}
