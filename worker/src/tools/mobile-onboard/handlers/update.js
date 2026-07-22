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
  mobileInfoKey,
  ataAddress,
  DC_MINT,
  HELIUM_COMMON_LUT,
  buildUpdateMobileInfoInstruction,
  fetchAsset,
  fetchAssetProof,
  getCanopyDepth,
  parseMobileInfo,
} from "../../../lib/helium-solana.js";
import { getMobileOnboardFees, feesForDeviceType } from "../services/fees.js";

/**
 * POST /update
 * Body: { owner, gateway, location }
 *   owner:    connected wallet (Solana base58) — must own the Hotspot cNFT
 *   gateway:  Helium-format entity key
 *   location: H3 res-12 cell as a hex string (required — location is the only
 *             field this tool updates; deployment_info is always left unchanged)
 *
 * Builds the unsigned update_mobile_info_v0 transaction to re-assert an
 * already-onboarded Mobile Hotspot's location. Mirrors update-location's
 * /build handler (v0 message + Helium common LUT, ownership gate, proactive
 * DC check against the MOBILE location_staking_fee).
 */
export async function handleUpdate(request, env) {
  const url = new URL(request.url);
  const isLocalDev = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const simulateOnly = isLocalDev && url.searchParams.get("simulate") === "1";

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const { owner: ownerStr, gateway, location } = body;
  if (!ownerStr) return jsonResponse({ error: "Missing owner address" }, 400);
  if (!gateway) return jsonResponse({ error: "Missing gateway" }, 400);
  if (typeof location !== "string" || !/^[0-9a-fA-F]{1,16}$/.test(location)) {
    return jsonResponse({ error: "Invalid location — expected an H3 cell as a hex string" }, 400);
  }

  let ownerPubkey;
  try {
    ownerPubkey = new PublicKey(ownerStr);
  } catch {
    return jsonResponse({ error: "Invalid owner address" }, 400);
  }

  let ktaKey, infoKey;
  try {
    ktaKey = keyToAssetKey(gateway);
    infoKey = mobileInfoKey(gateway);
  } catch {
    return jsonResponse({ error: "Invalid gateway" }, 400);
  }

  try {
    const rpcUrl = env.SOLANA_RPC_URL;
    const connection = new Connection(rpcUrl);

    const [ktaAccount, mobileInfoAccount] = await Promise.all([
      connection.getAccountInfo(ktaKey),
      connection.getAccountInfo(infoKey),
    ]);

    if (!ktaAccount) {
      return jsonResponse({ error: "Hotspot not issued on-chain" }, 400);
    }
    if (!mobileInfoAccount) {
      return jsonResponse(
        { error: "Hotspot not onboarded on the Mobile network", not_onboarded: true },
        400,
      );
    }

    const assetId = new PublicKey(
      ktaAccount.data.slice(KTA_ASSET_OFFSET, KTA_ASSET_OFFSET + 32),
    ).toBase58();

    const [asset, proof, { blockhash }, lutResult, fees, dcAtaAccount] = await Promise.all([
      fetchAsset(rpcUrl, assetId),
      fetchAssetProof(rpcUrl, assetId),
      connection.getLatestBlockhash(),
      connection.getAddressLookupTable(HELIUM_COMMON_LUT).catch(() => null),
      getMobileOnboardFees(env),
      // "confirmed" so a just-topped-up wallet (DcMintModal confirms at
      // "confirmed") is seen immediately, not ~13s later at finalized.
      connection.getAccountInfo(ataAddress(ownerPubkey, DC_MINT), "confirmed"),
    ]);

    if (asset?.ownership?.owner !== ownerStr) {
      return jsonResponse({ error: "Connected wallet does not own this Hotspot" }, 403);
    }

    const merkleTree = new PublicKey(asset.compression.tree);
    const treeAccount = await connection.getAccountInfo(merkleTree);
    if (!treeAccount) {
      return jsonResponse({ error: "Merkle tree account not found" }, 500);
    }
    const canopyDepth = getCanopyDepth(treeAccount.data);

    // A location re-assert burns the location_staking_fee for the Hotspot's
    // actual device type (the Manage tab lists all of a wallet's Mobile
    // Hotspots, not only converted wifiDataOnly networks).
    const deviceType = parseMobileInfo(mobileInfoAccount.data).device_type;
    const requiredDc = feesForDeviceType(fees, deviceType).location_staking_fee;
    const currentDc = dcAtaAccount ? Number(dcAtaAccount.data.readBigUInt64LE(64)) : 0;
    if (currentDc < requiredDc) {
      return jsonResponse({
        dc_needed: true,
        required_dc: requiredDc,
        current_dc: currentDc,
      });
    }

    const updateIx = buildUpdateMobileInfoInstruction(
      ownerPubkey, gateway, merkleTree, asset, proof, canopyDepth,
      { location },
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
    console.error("mobile-onboard update error:", err.message);
    return jsonResponse({ error: `Failed to build update transaction: ${err.message}` }, 500);
  }
}
