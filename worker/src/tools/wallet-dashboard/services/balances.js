import { PublicKey } from "@solana/web3.js";
import { BALANCE_TOKENS } from "../config.js";
import { rpc } from "../utils.js";
import { deriveATA } from "../../hotspot-claimer/services/common.js";

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/**
 * Fetch a wallet's token balances: HNT / MOBILE / IOT / DC (SPL token accounts)
 * plus native SOL. Returns a map keyed by token key:
 *   { hnt: { label, decimals, amount, uiAmount, ataEstablished }, ..., sol: {...} }
 * `amount` is the raw integer string; `uiAmount` is the human-readable number.
 * `ataEstablished` is whether the wallet's canonical Associated Token Account for
 * that mint exists (true/false for SPL tokens; null for native SOL, which has no
 * ATA). A token must have an ATA before it can receive transfers/reward claims.
 */
export async function fetchBalances(env, wallet) {
  const [tokenAccounts, lamports] = await Promise.all([
    rpc(env, "getTokenAccountsByOwner", [
      wallet,
      { programId: SPL_TOKEN_PROGRAM },
      { encoding: "jsonParsed" },
    ]),
    rpc(env, "getBalance", [wallet]),
  ]);

  // Sum raw amounts per mint (a wallet can hold multiple accounts for one mint),
  // and record the set of token-account addresses so we can detect the ATA.
  const byMint = Object.create(null);
  const accountPubkeys = new Set();
  for (const acc of tokenAccounts?.value || []) {
    if (acc?.pubkey) accountPubkeys.add(acc.pubkey);
    const info = acc?.account?.data?.parsed?.info;
    if (!info?.mint) continue;
    const raw = BigInt(info.tokenAmount?.amount || "0");
    byMint[info.mint] = (byMint[info.mint] || 0n) + raw;
  }

  const ownerPk = new PublicKey(wallet);

  const balances = {};
  for (const [key, t] of Object.entries(BALANCE_TOKENS)) {
    const raw = t.native ? BigInt(lamports?.value ?? 0) : byMint[t.mint] || 0n;
    // Split on the BigInt before casting so very large balances don't lose
    // integer precision (Number(raw) would round above 2^53).
    const base = 10n ** BigInt(t.decimals);

    // The canonical ATA is established iff it's among the wallet's token accounts.
    let ataEstablished = null; // null = N/A (native SOL has no ATA)
    if (!t.native && t.mint) {
      const ata = deriveATA(ownerPk, new PublicKey(t.mint)).toBase58();
      ataEstablished = accountPubkeys.has(ata);
    }

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
