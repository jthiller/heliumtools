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
  buildOnboardMobileInstruction,
  fetchAsset,
  fetchAssetProof,
  getCanopyDepth,
} from "../../../lib/helium-solana.js";
import { getMobileOnboardFees } from "../services/fees.js";

// Helius/DAS error text for a cNFT the indexer hasn't picked up yet.
const DAS_NOT_FOUND_RE = /not found|RecordNotFound/i;

/**
 * POST /onboard
 * Body: { owner, gateway, location }
 *   owner:    connected wallet (Solana base58) — must own the Hotspot cNFT
 *   gateway:  Helium-format entity key
 *   location: H3 res-12 cell as a hex string (required — the mobile onboard
 *             always asserts a location, matching the CLI's mandatory --lat/--lon)
 *
 * Builds the unsigned onboard_data_only_mobile_hotspot_v0 transaction for the
 * wallet to sign. Requires the entity to be issued AND visible via DAS — the
 * indexer can lag the issue confirm by up to ~60s, so a missing keyToAsset
 * returns { not_indexed } and the frontend keeps polling /status.
 *
 * Burns dc_onboarding_fee + location_staking_fee in DC (no MOBILE); when the
 * wallet's DC is short we return { dc_needed } so the frontend can offer a
 * DcMintModal top-up before the user signs a doomed transaction.
 */
export async function handleOnboard(request, env) {
  const url = new URL(request.url);
  // `?simulate=1` is a local-dev validation aid (returns simulation logs instead
  // of the txn). Gated to localhost like update-location's build handler.
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
      return jsonResponse(
        { error: "Hotspot not issued on-chain yet", not_indexed: true },
        400,
      );
    }
    if (mobileInfoAccount) {
      return jsonResponse({ gateway, already_onboarded: true });
    }

    const assetId = new PublicKey(
      ktaAccount.data.slice(KTA_ASSET_OFFSET, KTA_ASSET_OFFSET + 32),
    ).toBase58();

    // The DAS calls are caught separately: the kta account exists at issue
    // confirmation, but the indexer can lag it by tens of seconds, and a
    // not-yet-indexed asset must surface as the retryable { not_indexed }
    // contract rather than a raw 500 (or a bogus 403 from the ownership gate).
    const [assetRes, proofRes, { blockhash }, lutResult, fees, dcAtaAccount] = await Promise.all([
      fetchAsset(rpcUrl, assetId).catch((err) => ({ __dasError: err })),
      fetchAssetProof(rpcUrl, assetId).catch((err) => ({ __dasError: err })),
      connection.getLatestBlockhash(),
      connection.getAddressLookupTable(HELIUM_COMMON_LUT).catch(() => null),
      getMobileOnboardFees(env),
      // Read the DC balance at "confirmed", not the connection's default
      // ("finalized"): a just-topped-up wallet (DcMintModal confirms at
      // "confirmed") would otherwise read stale-zero for ~13s and bounce the
      // user back to the top-up modal on every retry.
      connection.getAccountInfo(ataAddress(ownerPubkey, DC_MINT), "confirmed"),
    ]);

    const dasError = assetRes?.__dasError || proofRes?.__dasError;
    if (dasError) {
      if (DAS_NOT_FOUND_RE.test(dasError.message || "")) {
        return jsonResponse(
          { error: "Hotspot isn't indexed yet", not_indexed: true },
          400,
        );
      }
      throw dasError;
    }
    const asset = assetRes;
    const proof = proofRes;

    // A null/ownerless DAS result is the same not-yet-indexed window, not an
    // ownership failure.
    if (!asset?.ownership?.owner) {
      return jsonResponse(
        { error: "Hotspot isn't indexed yet", not_indexed: true },
        400,
      );
    }

    // Ownership gate: onboard_data_only_mobile_hotspot_v0 requires
    // hotspot_owner to sign, and verify_compressed_nft checks the leaf owner.
    if (asset.ownership.owner !== ownerStr) {
      return jsonResponse({ error: "Connected wallet does not own this Hotspot" }, 403);
    }

    // Merkle tree from the asset (not DataOnlyConfig) — the proof is against
    // the tree the cNFT actually lives in.
    const merkleTree = new PublicKey(asset.compression.tree);
    const treeAccount = await connection.getAccountInfo(merkleTree);
    if (!treeAccount) {
      return jsonResponse({ error: "Merkle tree account not found" }, 500);
    }
    const canopyDepth = getCanopyDepth(treeAccount.data);

    const requiredDc = fees.wifiDataOnly.dc_onboarding_fee + fees.wifiDataOnly.location_staking_fee;
    const currentDc = dcAtaAccount ? Number(dcAtaAccount.data.readBigUInt64LE(64)) : 0;
    if (currentDc < requiredDc) {
      return jsonResponse({
        dc_needed: true,
        required_dc: requiredDc,
        current_dc: currentDc,
      });
    }

    const onboardIx = buildOnboardMobileInstruction(
      ownerPubkey, gateway, merkleTree, asset, proof, canopyDepth,
      { location },
    );

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });
    const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

    const lookupTables = lutResult?.value ? [lutResult.value] : [];
    const message = new TransactionMessage({
      payerKey: ownerPubkey,
      recentBlockhash: blockhash,
      instructions: [computeBudgetIx, computePriceIx, onboardIx],
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
      gateway,
      already_onboarded: false,
      transaction: Buffer.from(vtx.serialize()).toString("base64"),
    });
  } catch (err) {
    console.error("mobile-onboard onboard error:", err.message);
    return jsonResponse({ error: `Failed to build onboard transaction: ${err.message}` }, 500);
  }
}
