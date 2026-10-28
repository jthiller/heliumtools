// Council Emissions (HIP-149 Advisory Council emissions) — configuration.
//
// HIP-149 mints a fixed HNT carve-out for the five elected Advisory Council
// seats every epoch into the token account of a mini-fanout, which pays each
// seat an equal share daily at 00:00 UTC via tuktuk. This tool follows every
// emission to each seat wallet and then wherever that HNT goes.
// Everything below was verified on chain (see CLAUDE.md for the evidence).

export const HNT_MINT = "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux";
export const HNT_DECIMALS = 8;
export const DC_MINT = "dcuc8Amr83Wz27ZkQ2K9NS6r8zRpf1J6cvArEBDZDmm";

// The council mini-fanout. Its PDA is ["mini_fanout", namespace, "hip149-council"]
// under the mini-fanout program; shares, schedule and delegates are only
// changeable by its owner (the Helium governance Squads vault).
export const FANOUT = {
  pda: "2pCpQYrUmQor9igsF4cY7tkmd3jBQzHFEB75gtpjdWA2",
  tokenAccount: "EYbAXgLq1aRr9a9y55DbjfMdXNrZuMa69WXN9c1UR6eK",
  owner: "pULUgsYtKvT7qhsL8QJ2oJXYQUeCCdjtfawPnBqEr3U",
  seed: "hip149-council",
  schedule: "0 0 0 * * *",
  // Creation tx 5nwytJpV8Gp36RN9ChgrhAio3CmGuVoAa8xztxoYVqvuzVbdtbuDD4V3B6vk47TZWBUsK94fXKBRD5HhT2Zk5zVY.
  // The index window starts here; anything a seat held before is its opening balance.
  createdAt: 1785786956,
};

// The five seat wallets and their canonical HNT ATAs, in share order. A drift
// guard and the seed for indexing: seats are re-derived from emission credits on
// every replay, so a seat change shows up without a code change.
export const EXPECTED_SEATS = [
  { wallet: "B8ueUcdCLRZxExQgFUYkvt11q2PM9EsS9NsLNLUC9Eq8", ata: "7UgDmNtt1stj9UUP3pkm735ktZG3BPFSpBY8aQbkAMvR" },
  { wallet: "LF5GanytFASceR5q22C1MZrtgKaNLUnTUmWzfUhGSE6", ata: "EqsbAbqMToJgsUGZMiR5LMsEc5b5kup6BM3Jhy3Ho9Cw" },
  { wallet: "ANQ7oJbmWU338cLpgsYXRBzdTx2UXpFjGg374LQaXfK", ata: "CHUhhzndf3BtrAswS7aGpdVdY4qCp2Dvv4QPXXR6rBaY" },
  { wallet: "7BDAwH1hTUHQJaAR4TURiqgNHakVnL75eS37kh3LvdH2", ata: "EispLvDgoB4LooAkbVu7hMnCrEg595QA1NF7nqtUBbwS" },
  { wallet: "GrUBdDfPU6ZPGZ8QaRtqUqQmYztj8CBrCz5vBraNJoYQ", ata: "ETsBvP5JVge6yrTUpqmYd5b9H9iCxu6ya8G3ELpWmJV" },
];

// Seat names, only ever from a public source that ties the wallet to a member:
// { [wallet]: { name, sourceUrl } }. No such source exists yet (HIP-149's
// quarterly compensation reports are the likely one), so seats show by address.
export const SEAT_NAMES = {};

// The HIP-149 Advisory Council election (heliumtools /vote) and its elected
// slate, shown apart from the seats because no public source maps them.
export const ELECTION_PROPOSAL = "EejcqoypTXfix3m8GrPwLPQfs1P16yCPhiyzkMLvLRx4";

export const PROGRAMS = {
  miniFanout: "mfanLprNnaiP4RX9Zz1BMcDosYHCqnG24H1fMEbi9Gn",
  tuktuk: "tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA",
  heliumSubDaos: "hdaoVTCqhfHHo75XdAMxBKdUqvq1i5bF23sisBqVgGR",
  circuitBreaker: "circAbx64bbsscPbQzZAUvuXpHqrCe6fLMzc2uKXz9g",
  voterStakeRegistry: "hvsrNC3NKbcryqDs2DocYHZ9yPKEVzdSjQG6RVtK1s8",
  dataCredits: "credMBJhYFzfn7NxBMdU4aUqFggAjgztaCcv2Fo6fPT",
};

// Swap venues seen on chain or long-standing. An HNT debit in a tx that runs any
// of these (top level or inner) is a swap; so is an HNT debit where the sender
// gains another token or SOL in the same tx, whatever the program.
export const SWAP_PROGRAMS = {
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter",
  JUP5cHjnnCx2DppVsufsLrXs8EBZeEZzGtEK9Gdz6ow: "Jupiter",
  "61DFfeTKM7trxYcPQCM78bJ794ddZprZpAwAnLiwTpYH": "Jupiter RFQ",
  j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X: "Jupiter limit order",
  DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH: "DFlow",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca",
  "6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma": "OKX router",
  proVF4pMXVaYqmy4NjniPh4pqKNfMmsihgd4wdkCX3u: "Swap router",
};

// The two sub-DAOs whose issue_rewards_v0 each mint the council's per-epoch carve-out.
export const SUB_DAOS = {
  "39Lw1RH6zt8AJvKn3BTxmUDofzduCM2J3kSaGDZ8L7Sk": "IOT",
  Gm9xDCJawDEKDrrQW6haw94gABaYzQwCq4ZQU8h8bd22: "MOBILE",
};

// HNT DAO veHNT delegator rewards pool: an HNT inflow from here is a claimed
// delegation reward, not a transfer from a person.
export const DELEGATOR_POOL = "A7AjQhocZZvQXQJ5ducRF7gkconjNZfMNCjKguShoe8G";

// Tracing caps. Anything they stop is shown as "Not traced further", with the reason.
export const MAX_HOPS = 6;
export const MIN_TRACE_RAW = 100_000_000n; // 1 HNT: smaller onward moves aren't followed
export const MAX_TRACKED_NODES = 150; // downstream token accounts followed in total
export const NODE_SIG_CAP = 1500; // a downstream account busier than this is not followed

// Indexer budget per cron run (Workers subrequest and CPU limits; the Helius RPC
// is shared with every other tool's cron).
export const DECODE_BUDGET_PER_RUN = 150;
export const RPC_BATCH = 25;
export const IDENTITY_LOOKUPS_PER_RUN = 10;
export const SIG_PAGE = 1000;
export const ACCOUNT_DISCOVERY_MS = 24 * 60 * 60 * 1000;

// Kill switch for the cron indexer. Readers keep serving the last snapshot.
export const INDEX_ENABLED = true;

// Bump when classify/trace rules change: the next run replays every stored tx.
export const CLASSIFIER_VERSION = 1;

export const IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const IDENTITY_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOCK_TTL_SECONDS = 600;
export const KV = {
  lock: "ce:lock",
  summary: "ce:snap",
  seat: (wallet) => `ce:seat:${wallet}`,
  runs: "ce:runs",
  labels: "ce:labels",
  meta: "ce:meta",
};
export const RATE_LIMIT = { prefix: "rl:ce", maxRequests: 60, windowSeconds: 60 };
