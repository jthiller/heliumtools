import { jsonResponse } from "../../../lib/response.js";
import { checkIpRateLimit } from "../../../lib/rateLimit.js";
import {
  HNT_MINT,
  HNT_REGISTRAR_KEY,
  DAO_KEY,
  SECONDS_PER_EPOCH,
  positionKey as derivePositionKey,
  delegatedPositionKey as deriveDelegatedPositionKey,
  daoEpochInfoKey,
  subDaoEpochInfoKey,
  currentEpoch as computeCurrentEpoch,
} from "../../../lib/helium-solana.js";
import { fetchAccount, fetchMultipleAccounts } from "../../hotspot-claimer/services/common.js";
import { MAX_POSITION_LOOKUPS_PER_MINUTE } from "../config.js";
import { parseSolanaAddress, formatNative } from "../utils.js";
import {
  decodePosition,
  decodeDelegatedPosition,
  decodeRegistrar,
  decodeDaoEpochInfo,
  decodeSubDaoEpochInfo,
  isEpochClaimed,
} from "../services/decode.js";
import { computeVeHntAt, resolveEpochReward } from "../services/compute.js";
import { RegistrarCache, batchCachedAccounts, DAO_EPOCH_TTL } from "../services/cache.js";

const HNT_DECIMALS = 8;
const DNT_DECIMALS = 6;

export async function handlePositionEpochs(url, env, request) {
  const limitErr = await checkIpRateLimit(env, request, {
    prefix: "rl:vehnt:epochs",
    maxRequests: MAX_POSITION_LOOKUPS_PER_MINUTE,
    windowSeconds: 60,
  });
  if (limitErr) return limitErr;

  const mint = parseSolanaAddress(url.searchParams.get("positionMint"));
  if (!mint) return jsonResponse({ error: "Invalid positionMint." }, 400);

  try {
    const positionKey = derivePositionKey(mint);
    const delegatedKey = deriveDelegatedPositionKey(positionKey);

    const [registrarBuf, positionBuf, delegatedBuf] = await Promise.all([
      RegistrarCache(env, () => fetchAccount(env, HNT_REGISTRAR_KEY)),
      fetchAccount(env, positionKey),
      fetchAccount(env, delegatedKey),
    ]);
    if (!registrarBuf) return jsonResponse({ error: "Registrar not found." }, 500);
    if (!positionBuf) return jsonResponse({ error: "Position not found." }, 404);

    const registrar = decodeRegistrar(registrarBuf);
    const position = decodePosition(positionBuf);
    const delegation = delegatedBuf ? decodeDelegatedPosition(delegatedBuf) : null;

    const vmcIdx = registrar.votingMints.findIndex(
      (v) => v.mint.toBase58() === HNT_MINT.toBase58(),
    );
    if (vmcIdx === -1) {
      return jsonResponse({ error: "Registrar missing HNT voting mint." }, 500);
    }
    const vmc = registrar.votingMints[vmcIdx];
    const nowTs = Math.floor(Date.now() / 1000);
    const currentEpoch = computeCurrentEpoch(nowTs);

    if (!delegation) {
      return jsonResponse({
        positionKey: positionKey.toBase58(),
        mint: mint.toBase58(),
        delegated: false,
        currentEpoch,
        epochs: [],
      });
    }

    // The bitmap covers the range (lastClaimedEpoch, lastClaimedEpoch+128].
    // Epochs with the bit set have already been claimed (possibly out of
    // order), so their rewards are spent — exclude them so the drilldown
    // only surfaces actually-claimable epochs.
    const epochs = [];
    for (let e = delegation.lastClaimedEpoch + 1; e < currentEpoch; e++) {
      if (!isEpochClaimed(delegation, e)) epochs.push(e);
    }

    const [daoBufs, subDaoBufs] = await Promise.all([
      epochs.length === 0 ? [] : batchCachedAccounts(
        env,
        epochs.map((e) => ({
          kvKey: `ve-hnt:daoEpoch:${e}`,
          pubkey: daoEpochInfoKey(DAO_KEY, e),
        })),
        DAO_EPOCH_TTL,
      ),
      epochs.length === 0 ? [] : fetchMultipleAccounts(
        env,
        epochs.map((e) => subDaoEpochInfoKey(delegation.subDao, e)),
      ),
    ]);

    const rows = epochs.map((epoch, i) => {
      const epochStartTs = epoch * SECONDS_PER_EPOCH;
      const dao = daoBufs[i] ? decodeDaoEpochInfo(daoBufs[i]) : null;
      const subDao = subDaoBufs[i] ? decodeSubDaoEpochInfo(subDaoBufs[i]) : null;
      const positionVehnt = computeVeHntAt(position, vmc, epochStartTs);
      const { claimableHnt, claimableDnt, reason } = resolveEpochReward(positionVehnt, dao, subDao);

      return {
        epoch,
        startTs: epochStartTs,
        positionVehnt: formatNative(positionVehnt, HNT_DECIMALS),
        claimable: {
          hnt: formatNative(claimableHnt, HNT_DECIMALS),
          dnt: claimableDnt > 0n ? formatNative(claimableDnt, DNT_DECIMALS) : "0",
        },
        reason,
      };
    });

    return jsonResponse({
      positionKey: positionKey.toBase58(),
      mint: mint.toBase58(),
      delegated: true,
      subDao: delegation.subDao.toBase58(),
      lastClaimedEpoch: delegation.lastClaimedEpoch,
      expirationTs: delegation.expirationTs,
      lockupEndTs: position.lockup.endTs,
      lockupKind: position.lockup.kind,
      currentEpoch,
      epochs: rows,
    });
  } catch (err) {
    console.error("ve-hnt position-epochs error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load per-epoch breakdown." }, 500);
  }
}
