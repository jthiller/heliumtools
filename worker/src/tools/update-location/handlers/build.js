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
} from "../../../lib/helium-solana.js";
import { getOnboardFees } from "../../iot-onboard/services/fees.js";
import { parseIotInfo } from "./status.js";

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
  const simulateOnly = url.searchParams.get("simulate") === "1";

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
  const hasElevation = elevation !== null && elevation !== undefined;
  const hasGain = gain !== null && gain !== undefined;
  if (!hasLocation && !hasElevation && !hasGain) {
    return jsonResponse({ error: "Nothing to update — provide location, elevation, or gain" }, 400);
  }

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  try {
    const rpcUrl = env.SOLANA_RPC_URL;
    const connection = new Connection(rpcUrl);

    // Batch 1: keyToAsset + iotInfo. Both must exist (issued + onboarded).
    const [ktaAccount, iotInfoAccount] = await Promise.all([
      connection.getAccountInfo(keyToAssetKey(gateway_pubkey)),
      connection.getAccountInfo(iotInfoKey(gateway_pubkey)),
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

    // Batch 2: DAS asset + proof, blockhash, and the LUT in parallel.
    const [asset, proof, { blockhash }, lutResult] = await Promise.all([
      fetchAsset(rpcUrl, assetId),
      fetchAssetProof(rpcUrl, assetId),
      connection.getLatestBlockhash(),
      connection.getAddressLookupTable(HELIUM_COMMON_LUT),
    ]);

    // Ownership gate: the connected wallet must own the cNFT (update_iot_info_v0
    // requires hotspot_owner to sign). Turns an opaque on-chain failure into a
    // clear error, and catches a transfer between fleet-load and submit.
    if (asset?.ownership?.owner !== ownerStr) {
      return jsonResponse({ error: "Connected wallet does not own this Hotspot" }, 403);
    }

    // Merkle tree from the asset (NOT DataOnlyConfig) so full + data-only work.
    const merkleTree = new PublicKey(asset.compression.tree);
    const treeAccount = await connection.getAccountInfo(merkleTree);
    if (!treeAccount) {
      return jsonResponse({ error: "Merkle tree account not found" }, 500);
    }
    const canopyDepth = getCanopyDepth(treeAccount.data);

    // Proactive DC check when location changes — surface a top-up signal before
    // the user signs a doomed transaction.
    if (hasLocation) {
      const info = parseIotInfo(iotInfoAccount.data);
      const fees = await getOnboardFees(env);
      const deviceType = info.is_full_hotspot ? "full" : "data_only";
      const requiredDc = fees[deviceType].location;

      let currentDc = 0;
      const dcAta = await connection.getAccountInfo(ataAddress(ownerPubkey, DC_MINT));
      if (dcAta) currentDc = Number(dcAta.data.readBigUInt64LE(64));

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
      {
        location: hasLocation ? location : null,
        elevation: hasElevation ? elevation : null,
        gain: hasGain ? gain : null,
      },
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
