import { titleCase } from "../utils.js";

const MAX_PAGES = 5;
const PAGE_SIZE = 1000;

/**
 * Fetch all Helium hotspot NFTs owned by a wallet using DAS getAssetsByOwner.
 * Paginates up to MAX_PAGES (5000 assets max).
 * Returns array of { entityKey, name, network }.
 */
export async function getWalletHotspots(env, walletAddress) {
  const hotspots = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    const response = await fetch(env.SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAssetsByOwner",
        params: {
          ownerAddress: walletAddress,
          page,
          limit: PAGE_SIZE,
        },
      }),
    });

    const json = await response.json();
    if (json.error) {
      throw new Error(`getAssetsByOwner: ${json.error.message}`);
    }

    const items = json.result?.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      const symbol = (item.content?.metadata?.symbol || "").toUpperCase();
      const attributes = item.content?.metadata?.attributes || [];

      // Helium Hotspot NFTs use symbol "HOTSPOT" with ecc_compact + rewardable attributes.
      // Older NFTs may use "IOT" or "MOBILE" as the symbol.
      const isHeliumHotspot =
        symbol === "HOTSPOT" ||
        symbol.includes("IOT") ||
        symbol.includes("MOBILE");

      if (!isHeliumHotspot) continue;

      const eccAttr = attributes.find(
        (a) => a.trait_type === "ecc_compact" || a.trait_type === "entity_key"
      );
      if (!eccAttr?.value) continue;

      // Network type will be determined during on-chain resolve (iot_info vs mobile_info).
      // If symbol hints at a specific network, use it; otherwise leave null.
      let network = null;
      if (symbol.includes("IOT")) network = "iot";
      else if (symbol.includes("MOBILE")) network = "mobile";

      hotspots.push({
        entityKey: eccAttr.value,
        name: titleCase(item.content?.metadata?.name),
        network,
      });
    }

    if (items.length < PAGE_SIZE) break;
    page++;
  }

  return hotspots;
}
