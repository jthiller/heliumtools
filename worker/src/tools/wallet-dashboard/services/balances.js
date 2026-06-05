import { PublicKey } from "@solana/web3.js";
import { BALANCE_TOKENS } from "../config.js";
import { rpc } from "../utils.js";
import { deriveATA } from "../../hotspot-claimer/services/common.js";

/**
 * Fetch a wallet's token balances: HNT / MOBILE / IOT / DC plus native SOL.
 * Returns a map keyed by token key:
 *   { hnt: { label, decimals, amount, uiAmount, ataEstablished }, ..., sol: {...} }
 * `amount` is the raw integer string; `uiAmount` is the human-readable number.
 * `ataEstablished` is whether the wallet's canonical Associated Token Account for
 * that mint exists (true/false for SPL tokens; null for native SOL, which has no
 * ATA). A token must have an ATA before it can receive transfers/reward claims.
 *
 * We read ONLY the canonical ATA for each SPL token (one bounded
 * getMultipleAccounts) rather than enumerating every SPL account the wallet owns,
 * so a spam/airdrop wallet with thousands of token accounts can't bloat the RPC
 * response. The ATA's existence doubles as `ataEstablished`.
 */
export async function fetchBalances(env, wallet) {
  const ownerPk = new PublicKey(wallet);
  const splKeys = Object.keys(BALANCE_TOKENS).filter((k) => !BALANCE_TOKENS[k].native);
  const atas = splKeys.map((k) =>
    deriveATA(ownerPk, new PublicKey(BALANCE_TOKENS[k].mint)).toBase58(),
  );

  const [accounts, lamports] = await Promise.all([
    atas.length
      ? rpc(env, "getMultipleAccounts", [atas, { encoding: "jsonParsed" }])
      : Promise.resolve({ value: [] }),
    rpc(env, "getBalance", [wallet]),
  ]);

  // Each SPL token → its ATA account (null when the ATA doesn't exist).
  const accByKey = {};
  splKeys.forEach((k, i) => {
    accByKey[k] = accounts?.value?.[i] ?? null;
  });

  const balances = {};
  for (const [key, t] of Object.entries(BALANCE_TOKENS)) {
    let raw;
    let ataEstablished;
    if (t.native) {
      raw = BigInt(lamports?.value ?? 0);
      ataEstablished = null; // native SOL has no ATA
    } else {
      const acc = accByKey[key];
      ataEstablished = acc != null;
      raw = BigInt(acc?.data?.parsed?.info?.tokenAmount?.amount || "0");
    }
    // Split on the BigInt before casting so very large balances don't lose
    // integer precision (Number(raw) would round above 2^53).
    const base = 10n ** BigInt(t.decimals);
    balances[key] = {
      label: t.label,
      decimals: t.decimals,
      amount: raw.toString(),
      uiAmount: Number(raw / base) + Number(raw % base) / Number(base),
      ataEstablished,
    };
  }
  return balances;
}
