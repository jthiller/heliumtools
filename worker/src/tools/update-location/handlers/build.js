import {
  PublicKey,
  ComputeBudgetProgram,
  VersionedTransaction,
  TransactionMessage,
  Connection,
} from "@solana/web3.js";
import { jsonResponse } from "../../../lib/response.js";
import {
  KTA_ASSET_OFFSET,
  keyToAssetKey,
  iotInfoKey,
  ataAddress,
  DC_MINT,
  HELIUM_COMMON_LUT,
  buildUpdateIotInfoInstruction,
  fetchAsset,
  fetchAssetProof,
  getCanopyDepth,
  parseIotInfo,
  IOT_MIN_GAIN,
  IOT_MAX_GAIN,
} from "../../../lib/helium-solana.js";
import { getOnboardFees } from "../../iot-onboard/services/fees.js";

/**
 * POST /build
 * Body: { owner, gateway_pubkey, location?, elevation?, gain? }
 *   owner:        connected wallet (Solana base58) — must own the Hotspot cNFT
 *   gateway_pubkey: Helium-format entity key
 *   location:     H3 res-12 cell as a hex string (omit/null = leave unchanged)
 *   elevation:    meters (omit/null = leave unchanged)
 *   gain:         antenna gain in dBi × 10 (omit/null = leave unchanged)
 *
 * Builds the unsigned update_iot_info_v0 transaction for the wallet to sign.
 * Adapted from multi-gateway/handlers/issue.js handleOnboard, but requires the
 * Hotspot to already be onboarded, verifies ownership, derives the merkle tree
 * from the asset (so full + data-only both work), and compiles a v0 message
 * with the Helium common LUT to stay under the transaction-size cap.
 *
 * A location change incurs the DC location-assert fee; when the wallet's DC is
 * short we return { dc_needed } so the frontend can offer a top-up.
 */
export async function handleBuildUpdate(request, env) {
  const url = new URL(request.url);
  // `?simulate=1` is a local-dev validation aid (returns simulation logs instead
  // of the txn). Gate it to localhost so it can't add RPC load or expose debug
  // output to public callers in production.
  const isLocalDev = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const simulateOnly = isLocalDev && url.searchParams.get("simulate") === "1";

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, gateway_pubkey, location, elevation, gain } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!gateway_pubkey) return jsonResponse({ error: "Missing gateway_pubkey" }, 400);

  const hasLocation = location !== null && location !== undefined && location !== "";
  // elevation/gain are passed straight to the builder, which encodes null/undefined
  // as Borsh None ("leave unchanged"); only `hasLocation` gates real branches below.
  if (!hasLocation && elevation == null && gain == null) {
    return jsonResponse({ error: "Nothing to update — provide location, elevation, or gain" }, 400);
  }

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  // Derive the PDAs up front so a malformed gateway_pubkey (non-base58) returns
  // a 400 instead of throwing into the outer catch as a 500.
  let ktaKey, infoKey;
  try {
    ktaKey = keyToAssetKey(gateway_pubkey);
    infoKey = iotInfoKey(gateway_pubkey);
  } catch {
    return jsonResponse({ error: "Invalid gateway_pubkey" }, 400);
  }

  // Validate the optional fields up front so malformed client input is a clean
  // 400 rather than a 500 thrown from encodeOptionU64/writeInt32LE deeper in.
  if (hasLocation && !/^[0-9a-fA-F]{1,16}$/.test(location)) {
    return jsonResponse({ error: "Invalid location — expected an H3 cell as a hex string" }, 400);
  }
  if (elevation != null && !Number.isInteger(elevation)) {
    return jsonResponse({ error: "Invalid elevation — expected an integer (meters)" }, 400);
  }
  if (gain != null && (!Number.isInteger(gain) || gain < IOT_MIN_GAIN || gain > IOT_MAX_GAIN)) {
    // The on-chain validate_iot_gain constraint rejects out-of-range gain with an
    // opaque 0x7d3; surface a clear 400 instead.
    return jsonResponse({
      error: `Invalid gain — antenna gain must be ${IOT_MIN_GAIN / 10}–${IOT_MAX_GAIN / 10} dBi`,
    }, 400);
  }

  try {
    const rpcUrl = env.SOLANA_RPC_URL;
    const connection = new Connection(rpcUrl);

    // Batch 1: keyToAsset + iotInfo. Both must exist (issued + onboarded).
    const [ktaAccount, iotInfoAccount] = await Promise.all([
      connection.getAccountInfo(ktaKey),
      connection.getAccountInfo(infoKey),
    ]);

    if (!ktaAccount) {
      return jsonResponse({ error: "Hotspot not issued on-chain" }, 400);
    }
    if (!iotInfoAccount) {
      return jsonResponse(
        { error: "Hotspot not onboarded — use IoT Hotspot Setup first", not_onboarded: true },
        400,
      );
    }

    const assetId = new PublicKey(
      ktaAccount.data.slice(KTA_ASSET_OFFSET, KTA_ASSET_OFFSET + 32),
    ).toBase58();

    // Batch 2: DAS asset + proof, blockhash, the LUT, and — only when location
    // is changing — the fee table + the owner's DC balance. The fee/DC reads
    // depend on neither the asset nor the proof, so they run concurrently here
    // rather than serially after the tree read.
    const [asset, proof, { blockhash }, lutResult, fees, dcAtaAccount] = await Promise.all([
      fetchAsset(rpcUrl, assetId),
      fetchAssetProof(rpcUrl, assetId),
      connection.getLatestBlockhash(),
      // .catch so a transient LUT-fetch failure degrades to a no-LUT v0 message
      // rather than failing the whole build.
      connection.getAddressLookupTable(HELIUM_COMMON_LUT).catch(() => null),
      hasLocation ? getOnboardFees(env) : Promise.resolve(null),
      hasLocation ? connection.getAccountInfo(ataAddress(ownerPubkey, DC_MINT)) : Promise.resolve(null),
    ]);

    // Ownership gate: the connected wallet must own the cNFT (update_iot_info_v0
    // requires hotspot_owner to sign). Turns an opaque on-chain failure into a
    // clear error, and catches a transfer between fleet-load and submit.
    if (asset?.ownership?.owner !== ownerStr) {
      return jsonResponse({ error: "Connected wallet does not own this Hotspot" }, 403);
    }

    // Merkle tree from the asset (NOT DataOnlyConfig) so full + data-only work.
    // This read genuinely depends on the asset, so it can't join Batch 2.
    const merkleTree = new PublicKey(asset.compression.tree);
    const treeAccount = await connection.getAccountInfo(merkleTree);
    if (!treeAccount) {
      return jsonResponse({ error: "Merkle tree account not found" }, 500);
    }
    const canopyDepth = getCanopyDepth(treeAccount.data);

    // Proactive DC check when location changes — surface a top-up signal before
    // the user signs a doomed transaction. (fees + DC balance fetched in Batch 2.)
    if (hasLocation) {
      const deviceType = parseIotInfo(iotInfoAccount.data).is_full_hotspot ? "full" : "data_only";
      const requiredDc = fees[deviceType].location;
      const currentDc = dcAtaAccount ? Number(dcAtaAccount.data.readBigUInt64LE(64)) : 0;
      if (currentDc < requiredDc) {
        return jsonResponse({
          dc_needed: true,
          required_dc: requiredDc,
          current_dc: currentDc,
          device_type: deviceType,
        });
      }
    }

    const updateIx = buildUpdateIotInfoInstruction(
      ownerPubkey,
      gateway_pubkey,
      merkleTree,
      asset,
      proof,
      canopyDepth,
      { location, elevation, gain }, // builder encodes null/undefined as Borsh None
    );

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    const lookupTables = lutResult?.value ? [lutResult.value] : [];
    const message = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx, computePriceIx, updateIx],
    }).compileToV0Message(lookupTables);

    const vtx = new VersionedTransaction(message);

    // Dev-only validation aid: simulate the unsigned txn and return logs. A clean
    // sim confirms the account ordering + Borsh arg order without broadcasting.
    if (simulateOnly) {
      const sim = await connection.simulateTransaction(vtx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      return jsonResponse({ simulation: sim.value });
    }

    return jsonResponse({
      transaction: Buffer.from(vtx.serialize()).toString("base64"),
    });
  } catch (err) {
    console.error("update-location build error:", err.message);
    return jsonResponse({ error: `Failed to build update transaction: ${err.message}` }, 500);
  }
}
