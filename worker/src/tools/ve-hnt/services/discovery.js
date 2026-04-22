import { PublicKey } from "@solana/web3.js";
import { HNT_POSITION_COLLECTION_KEY } from "../../../lib/helium-solana.js";

const DAS_PAGE_LIMIT = 1000;
const MAX_PAGES = 10; // 10k NFTs per wallet is plenty of headroom

/**
 * Find all HNT position NFT mints owned by `wallet`.
 *
 * Uses Helius DAS getAssetsByOwner and filters assets whose grouping
 * includes the HNT position collection PDA. That collection is fixed for
 * all HNT positions (derived from the VSR registrar at module load).
 */
export async function findPositionMints(env, wallet) {
  if (!env.SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL is not configured");

  const collectionKey = HNT_POSITION_COLLECTION_KEY.toBase58();
  const walletStr = wallet instanceof PublicKey ? wallet.toBase58() : wallet;
  const mints = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const resp = await fetch(env.SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAssetsByOwner",
        params: {
          ownerAddress: walletStr,
          page,
          limit: DAS_PAGE_LIMIT,
          displayOptions: { showFungible: false },
        },
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(`getAssetsByOwner: ${data.error.message}`);
    const items = data.result?.items || [];

    for (const item of items) {
      if (!Array.isArray(item.grouping)) continue;
      const inCollection = item.grouping.some(
        (g) => g.group_key === "collection" && g.group_value === collectionKey,
      );
      if (inCollection && item.id) mints.push(new PublicKey(item.id));
    }

    if (items.length < DAS_PAGE_LIMIT) break;
  }

  return mints;
}
