// Manual Borsh decoders for Helium governance accounts. No Anchor dependency in
// the worker; field order/types verified against source:
//   ProposalV0 / Choice / ProposalState — helium/modular-governance
//     programs/proposal/src/state.rs
//   VoteMarkerV0 — helium/helium-program-library
//     programs/voter-stake-registry/src/state/marker.rs
//   discriminators — sha256("account:<Name>")[..8], confirmed against the IDLs.

import { PublicKey } from "@solana/web3.js";

const DISC = 8; // every Anchor account is prefixed by an 8-byte discriminator.

/**
 * Sequential little-endian Borsh reader. Mirrors the patterns already used in
 * the ve-hnt decoders, but as a cursor object so the variable-length proposal
 * layout (nested Vec/String/Option/enum) stays readable.
 */
class Reader {
  constructor(buf) {
    this.buf = buf;
    this.o = 0;
  }
  skip(n) { this.o += n; }
  u8() { const v = this.buf.readUInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.buf.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.buf.readUInt32LE(this.o); this.o += 4; return v; }
  i64() { const v = this.buf.readBigInt64LE(this.o); this.o += 8; return v; }
  u128() {
    const lo = this.buf.readBigUInt64LE(this.o);
    const hi = this.buf.readBigUInt64LE(this.o + 8);
    this.o += 16;
    return (hi << 64n) | lo;
  }
  pubkey() {
    const pk = new PublicKey(this.buf.slice(this.o, this.o + 32));
    this.o += 32;
    return pk;
  }
  bytes() {
    const n = this.u32();
    const b = this.buf.slice(this.o, this.o + n);
    this.o += n;
    return b;
  }
  string() { return this.bytes().toString("utf8"); }
  vecU16() {
    const n = this.u32();
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = this.u16();
    return a;
  }
  optionString() { return this.u8() === 1 ? this.string() : null; }
}

/**
 * ProposalState enum (Borsh: 1-byte variant index + variant fields).
 *   0 Draft · 1 Cancelled · 2 Voting{start_ts} ·
 *   3 Resolved{choices: Vec<u16>, end_ts} · 4 Custom{name, bin}
 * Resolved.choices holds the WINNING choice indices (into ProposalV0.choices).
 */
function decodeProposalState(r) {
  const tag = r.u8();
  switch (tag) {
    case 0: return { kind: "draft" };
    case 1: return { kind: "cancelled" };
    case 2: return { kind: "voting", startTs: Number(r.i64()) };
    case 3: {
      const winningChoices = r.vecU16();
      const endTs = Number(r.i64());
      return { kind: "resolved", winningChoices, endTs };
    }
    case 4: {
      const name = r.string();
      r.bytes(); // bin: Vec<u8> — unused
      return { kind: "custom", name };
    }
    default: return { kind: "unknown", tag };
  }
}

/**
 * ProposalV0 (program propFYx…):
 *   namespace: Pubkey, owner: Pubkey, state: ProposalState, created_at: i64,
 *   proposal_config: Pubkey, max_choices_per_voter: u16, seed: Vec<u8>,
 *   name: String, uri: String, tags: Vec<String>,
 *   choices: Vec<Choice{ weight: u128, name: String, uri: Option<String> }>,
 *   bump_seed: u8
 *
 * The account is allocated at a fixed size and right-padded with zeros — we
 * parse forward and stop after the declared fields, ignoring trailing slack.
 */
export function decodeProposal(buf) {
  const r = new Reader(buf);
  r.skip(DISC);
  const namespace = r.pubkey();
  const owner = r.pubkey();
  const state = decodeProposalState(r);
  const createdAt = Number(r.i64());
  const proposalConfig = r.pubkey();
  const maxChoicesPerVoter = r.u16();
  r.bytes(); // seed: Vec<u8> — unused
  const name = r.string();
  const uri = r.string();

  const tagsLen = r.u32();
  const tags = new Array(tagsLen);
  for (let i = 0; i < tagsLen; i++) tags[i] = r.string();

  const choicesLen = r.u32();
  const choices = new Array(choicesLen);
  for (let i = 0; i < choicesLen; i++) {
    const weight = r.u128();
    const choiceName = r.string();
    const choiceUri = r.optionString();
    choices[i] = { index: i, weight, name: choiceName, uri: choiceUri };
  }

  return {
    namespace: namespace.toBase58(),
    owner: owner.toBase58(),
    proposalConfig: proposalConfig.toBase58(),
    state,
    createdAt,
    maxChoicesPerVoter,
    name,
    uri,
    tags,
    choices,
  };
}

/**
 * VoteMarkerV0 (program hvsrNC3… — the VSR variant, NOT nft_voter/token_voter):
 *   voter: Pubkey (offset 8), registrar: Pubkey (40), proposal: Pubkey (72),
 *   mint: Pubkey (104, the position NFT mint), choices: Vec<u16> (136),
 *   weight: u128, bump_seed: u8, _deprecated_relinquished: bool,
 *   proxy_index: u16, rent_refund: Pubkey
 *
 * There is NO timestamp field — per-vote time comes from transaction blockTime.
 */
export function decodeVoteMarker(buf) {
  const r = new Reader(buf);
  r.skip(DISC);
  const voter = r.pubkey();
  r.skip(32); // registrar — unused
  const proposal = r.pubkey();
  const mint = r.pubkey();
  const choices = r.vecU16();
  const weight = r.u128();
  r.skip(1); // bump_seed
  const relinquished = r.u8() === 1;
  const proxyIndex = r.u16();

  return {
    voter: voter.toBase58(),
    proposal: proposal.toBase58(),
    mint: mint.toBase58(),
    choices,
    weight,
    relinquished,
    proxyIndex,
  };
}
