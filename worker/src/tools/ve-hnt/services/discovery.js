import { PublicKey } from "@solana/web3.js";
import { HNT_POSITION_COLLECTION_KEY } from "../../../lib/helium-solana.js";

const DAS_PAGE_LIMIT = 1000;
const MAX_PAGES = 10;

/**
 * Find all HNT position NFT mints owned by `wallet`.
 *
 * veHNT position "NFTs" are classified as fungible-token-like by Helius
 * DAS (SPL Token with decimals=0 and supply=1), so getAssetsByOwner with
 * default showFungible=false excludes them. We use searchAssets with
 * tokenType:"fungible" and a server-side collection filter — mirrors
 * helium-program-library/packages/voter-stake-registry-sdk/src/helpers.ts
 * getPositionKeysForOwner.
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
        method: "searchAssets",
        params: {
          ownerAddress: walletStr,
          tokenType: "fungible",
          grouping: ["collection", collectionKey],
          page,
          limit: DAS_PAGE_LIMIT,
        },
      }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(`searchAssets: ${data.error.message}`);
    const items = data.result?.items || [];

    for (const item of items) {
      if (!item.id) continue;
      // Defense-in-depth: server-side collection filter should already match,
      // but confirm the grouping to avoid accidentally decoding non-position
      // assets as PositionV0.
      const inCollection = Array.isArray(item.grouping)
        && item.grouping.some(
          (g) => g.group_key === "collection" && g.group_value === collectionKey,
        );
      if (inCollection) mints.push(new PublicKey(item.id));
    }

    if (items.length < DAS_PAGE_LIMIT) break;
  }

  return mints;
}
