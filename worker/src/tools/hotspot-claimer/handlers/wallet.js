import { PublicKey } from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../services/rateLimit.js";
import {
  MAX_LOOKUPS_PER_MINUTE,
  MAX_RECIPIENT_INITS_PER_DAY,
  ENTITY_API_BASE,
  TOKENS,
} from "../config.js";
import { isValidWalletAddress, todayUTC } from "../utils.js";
import { extractEntityApiInfo } from "../services/entity.js";
import { deriveATA, fetchMultipleAccounts } from "../services/common.js";

const TOKEN_KEYS = ["iot", "mobile", "hnt"];

async function checkOwnerAtas(env, ownerAddress) {
  const ownerPk = new PublicKey(ownerAddress);
  const atas = TOKEN_KEYS.map((tk) =>
    deriveATA(ownerPk, new PublicKey(TOKENS[tk].mint))
  );
  try {
    const accounts = await fetchMultipleAccounts(env, atas);
    const result = {};
    TOKEN_KEYS.forEach((tk, i) => { result[tk] = accounts[i] !== null; });
    return result;
  } catch (err) {
    console.error("Owner ATA check failed:", err.message);
    return null;
  }
}

/**
 * GET /wallet?address=<solana-wallet>
 *
 * Returns all hotspots owned by the wallet via Helium Entity API.
 * Rewards are NOT fetched here — frontend fetches them progressively.
 */
export async function handleWallet(url, env, request) {
  // Rate limit check
  const rateLimitError = await checkIpRateLimit(env, request, {
    prefix: "rl:wallet",
    maxRequests: MAX_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (rateLimitError) return rateLimitError;

  const address = url.searchParams.get("address");

  if (!isValidWalletAddress(address)) {
    return jsonResponse(
      { error: "Invalid wallet address. Must be a Solana base58 address." },
      400
    );
  }

  try {
    const response = await fetch(
      `${ENTITY_API_BASE}/v2/wallet/${address}`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return jsonResponse({ owner: address, hotspots: [], hotspots_count: 0 });
      }
      return jsonResponse(
        { error: "Failed to fetch wallet hotspots from Entity API." },
        502
      );
    }

    const data = await response.json();

    // Map hotspots to the shape the frontend needs
    const hotspots = (data.hotspots || []).map((h) => {
      const { network, info } = extractEntityApiInfo(h);

      return {
        entityKey: h.entity_key_str,
        assetId: h.asset_id,
        keyToAssetKey: h.key_to_asset_key,
        name: h.name || null,
        network,
        city: info.city || null,
        state: info.state || null,
        country: info.country || null,
        image: h.image || null,
      };
    });

    // Check init budget and owner ATAs in parallel
    const initKey = `claims:inits:${todayUTC()}`;
    const [initsTodayRaw, ownerAtas] = await Promise.all([
      env.KV.get(initKey),
      checkOwnerAtas(env, address),
    ]);
    const initsToday = parseInt(initsTodayRaw || "0", 10);
    const initsAvailable = initsToday < MAX_RECIPIENT_INITS_PER_DAY;

    console.log(JSON.stringify({
      event: "wallet_lookup",
      wallet: address,
      hotspots_count: hotspots.length,
      owner_atas: ownerAtas,
    }));

    return jsonResponse({
      owner: address,
      hotspots,
      hotspots_count: data.hotspots_count || hotspots.length,
      initsAvailable,
      ownerAtas,
    });
  } catch (err) {
    console.error("Wallet lookup error:", err.message, err.stack);
    return jsonResponse({ error: "Failed to fetch wallet hotspots." }, 500);
  }
}
