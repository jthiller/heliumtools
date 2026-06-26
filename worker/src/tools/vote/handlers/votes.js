import bs58 from "bs58";
import { jsonResponse } from "../../../lib/response.js";
import { VSR_PROGRAM } from "../../../lib/helium-solana.js";
import { getProgramAccounts } from "../services/rpc.js";
import { decodeVoteMarker } from "../services/decode.js";
import { parseProposalId, weightToVeHnt, kvGetJson, kvPutJson } from "../utils.js";
import {
  DEFAULT_PROPOSAL,
  VOTE_MARKER_DISCRIMINATOR,
  MAX_MARKERS_RETURNED,
  MAX_MARKERS_SCANNED,
  VOTES_CACHE_TTL,
} from "../config.js";

// base58 of the 8-byte VoteMarkerV0 discriminator — used as the type filter.
const MARKER_DISC_B58 = bs58.encode(Buffer.from(VOTE_MARKER_DISCRIMINATOR));
// The `proposal` field sits at offset 72 (8 disc + voter[32] + registrar[32]),
// matching heliumvote's useVotes memcmp.
const PROPOSAL_OFFSET = 72;

/**
 * GET /vote/votes?id=<pubkey>
 * The live voter roster — one VoteMarkerV0 per voting position that has cast a
 * vote on this proposal. Mirrors heliumvote's useVotes getProgramAccounts.
 *
 * Note: modern Helium closes markers after resolution, so a resolved proposal
 * may return few/none. Final tallies always come from /vote/proposal; this
 * endpoint is the live "who voted what" roster for open proposals.
 */
export async function handleVotes(url, env) {
  const id = parseProposalId(url.searchParams.get("id") || DEFAULT_PROPOSAL);
  if (!id) return jsonResponse({ error: "Invalid proposal address." }, 400);
  const address = id.toBase58();

  const cacheKey = `vote:votes:${address}`;
  const cached = await kvGetJson(env, cacheKey);
  if (cached) return jsonResponse(cached);

  try {
    let accounts = await getProgramAccounts(env, VSR_PROGRAM, [
      { offset: 0, bytesBase58: MARKER_DISC_B58 },
      { offset: PROPOSAL_OFFSET, bytesBase58: address },
    ]);

    // Defensive CPU bound — real proposals never approach this.
    const scanCapped = accounts.length > MAX_MARKERS_SCANNED;
    if (scanCapped) {
      console.log(JSON.stringify({
        event: "vote_votes_scan_capped",
        proposal: address,
        found: accounts.length,
        cap: MAX_MARKERS_SCANNED,
      }));
      accounts = accounts.slice(0, MAX_MARKERS_SCANNED);
    }

    const perChoice = new Map(); // choiceIndex -> bigint weight
    const voters = new Set();
    let totalWeight = 0n;
    const markers = [];

    for (const { buf } of accounts) {
      let m;
      try {
        m = decodeVoteMarker(buf);
      } catch {
        continue; // skip anything that doesn't decode as a marker
      }
      if (m.relinquished) continue; // withdrawn (legacy) — don't count
      totalWeight += m.weight;
      voters.add(m.voter);
      for (const c of m.choices) {
        perChoice.set(c, (perChoice.get(c) || 0n) + m.weight);
      }
      markers.push(m);
    }

    markers.sort((a, b) => (a.weight < b.weight ? 1 : a.weight > b.weight ? -1 : 0));
    const returned = markers.slice(0, MAX_MARKERS_RETURNED);

    const body = {
      proposal: address,
      markerCount: markers.length,
      uniqueVoters: voters.size,
      totalWeight: totalWeight.toString(),
      totalVeHnt: weightToVeHnt(totalWeight),
      truncated: markers.length > returned.length,
      scanCapped,
      returned: returned.length,
      perChoice: Array.from(perChoice.entries())
        .map(([index, weight]) => ({
          index,
          weight: weight.toString(),
          veHnt: weightToVeHnt(weight),
        }))
        .sort((a, b) => a.index - b.index),
      votes: returned.map((m) => ({
        voter: m.voter,
        mint: m.mint,
        choices: m.choices,
        weight: m.weight.toString(),
        veHnt: weightToVeHnt(m.weight),
        proxyIndex: m.proxyIndex,
      })),
    };

    await kvPutJson(env, cacheKey, body, VOTES_CACHE_TTL);
    console.log(JSON.stringify({
      event: "vote_votes",
      proposal: address,
      markerCount: body.markerCount,
      uniqueVoters: body.uniqueVoters,
    }));
    return jsonResponse(body);
  } catch (err) {
    console.error("vote votes error", err?.message, err?.stack);
    return jsonResponse({ error: "Failed to load votes." }, 500);
  }
}
