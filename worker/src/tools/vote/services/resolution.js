// Resolution meta — the vote's *scheduled* end time and (for elections) the
// number of winning seats. ProposalV0 itself only carries an end timestamp once
// resolved; while a vote is open those rules live in the state-controller's
// ResolutionSettingsV0 (reached via ProposalConfigV0.state_controller), as an
// RPN node list. We summarize the two renderable operands:
//   - endTs / offset  → scheduled close (EndTimestamp, or start + OffsetFromStartTs)
//   - seats           → Top{n} (how many choices win — e.g. 5 for the council election)
//
// Best-effort everywhere: any fetch/decode problem returns null and the caller
// renders exactly what it did before this feature existed. Configs are
// effectively immutable once a vote is live, so the summary is KV-cached per
// proposal-config address.

import { kvGetJson, kvPutJson } from "../../../lib/kv.js";
import { getAccount } from "./rpc.js";
import { decodeProposalConfig, decodeResolutionSettings } from "./decode.js";
import {
  PROPOSAL_PROGRAM,
  STATE_CONTROLLER_PROGRAM,
  PROPOSAL_CONFIG_DISCRIMINATOR,
  RESOLUTION_SETTINGS_DISCRIMINATOR,
  RESOLUTION_META_CACHE_TTL,
} from "../config.js";

function hasDiscriminator(buf, disc) {
  if (!buf || buf.length < 8) return false;
  for (let i = 0; i < 8; i++) if (buf[i] !== disc[i]) return false;
  return true;
}

/**
 * Fetch + summarize the resolution settings behind a proposal config.
 * Returns { endTimestamp, offsetFromStart, seats } (each possibly null), or
 * null when anything along the chain is missing/undecodable.
 */
export async function getResolutionMeta(env, proposalConfig) {
  if (!proposalConfig) return null;
  const cacheKey = `vote:resmeta:${proposalConfig}`;
  const cached = await kvGetJson(env, cacheKey);
  // `unknown` is the cached negative result (a controller we can't summarize):
  // without it every cron tick re-pays two getAccount calls for such proposals.
  if (cached) return cached.unknown ? null : cached;

  try {
    // Both accounts are type-checked (owner + Anchor discriminator) before
    // decoding — a proposal can name any account as its config, and reading
    // field offsets out of the wrong account type would yield garbage keys.
    const configAcc = await getAccount(env, proposalConfig);
    if (
      !configAcc ||
      configAcc.owner !== PROPOSAL_PROGRAM.toBase58() ||
      !hasDiscriminator(configAcc.buf, PROPOSAL_CONFIG_DISCRIMINATOR)
    ) {
      await kvPutJson(env, cacheKey, { unknown: true }, RESOLUTION_META_CACHE_TTL);
      return null;
    }
    const config = decodeProposalConfig(configAcc.buf);

    const settingsAcc = await getAccount(env, config.stateController);
    if (
      !settingsAcc ||
      settingsAcc.owner !== STATE_CONTROLLER_PROGRAM ||
      !hasDiscriminator(settingsAcc.buf, RESOLUTION_SETTINGS_DISCRIMINATOR)
    ) {
      // A custom state controller we don't understand — nothing to summarize.
      await kvPutJson(env, cacheKey, { unknown: true }, RESOLUTION_META_CACHE_TTL);
      return null;
    }
    const settings = decodeResolutionSettings(settingsAcc.buf);

    const meta = { endTimestamp: null, offsetFromStart: null, seats: null };
    for (const node of settings.nodes) {
      if (node.kind === "endTimestamp") meta.endTimestamp = node.endTs;
      else if (node.kind === "offsetFromStartTs") meta.offsetFromStart = node.offset;
      else if (node.kind === "top") meta.seats = node.n;
    }
    // A partial decode (unknown node aborted the parse) may be missing later
    // operands — serve it this cycle but never cache the truncated summary,
    // so a decoder fix takes effect without waiting out stale KV.
    if (!settings.partial) {
      await kvPutJson(env, cacheKey, meta, RESOLUTION_META_CACHE_TTL);
    }
    return meta;
  } catch (e) {
    // Transient fetch failure — uncached so the next refresh retries.
    console.error("vote resolution meta failed", proposalConfig, e?.message);
    return null;
  }
}

/** The scheduled close (unix sec) for an open vote, from its meta. */
export function scheduledEndTs(meta, startTs) {
  if (!meta) return null;
  if (meta.endTimestamp) return meta.endTimestamp;
  if (meta.offsetFromStart && startTs) return startTs + meta.offsetFromStart;
  return null;
}
