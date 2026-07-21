CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  verify_expires_at TEXT,
  created_at TEXT NOT NULL,
  uuid TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  escrow_account TEXT NOT NULL,
  label TEXT,
  webhook_url TEXT,
  created_at TEXT NOT NULL,
  last_notified_level INTEGER NOT NULL DEFAULT 0,
  last_balance_dc REAL,
  last_webhook_date TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE (user_id, escrow_account)
);

CREATE TABLE IF NOT EXISTS balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  balance_dc REAL NOT NULL,
  UNIQUE (subscription_id, date),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
);

-- Catalog of all OUIs observed on the network.
CREATE TABLE IF NOT EXISTS ouis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oui INTEGER NOT NULL UNIQUE,
  owner TEXT,
  payer TEXT,
  escrow TEXT,
  delegate_keys TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ouis_escrow ON ouis (escrow);

-- Daily DC balance snapshots for every OUI (used for charts regardless of subscription).
CREATE TABLE IF NOT EXISTS oui_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oui INTEGER NOT NULL,
  date TEXT NOT NULL,
  balance_dc REAL NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (oui, date),
  FOREIGN KEY (oui) REFERENCES ouis(oui)
);

-- Vote tool: one immutable event per vote (worker/src/tools/vote), keyed by the
-- VoteMarkerV0 account, recording the exact blockTime the vote was cast. The
-- cumulative per-choice curve is folded at read time, so the chart shows precise
-- vote times. Appended incrementally by the snapshot cron; the worker also
-- self-provisions this via CREATE TABLE IF NOT EXISTS (no manual migration).
CREATE TABLE IF NOT EXISTS vote_events (
  proposal TEXT NOT NULL,
  marker TEXT NOT NULL,           -- VoteMarkerV0 account pubkey (one per vote)
  ts INTEGER NOT NULL,            -- vote blockTime, unix seconds (precise)
  voter TEXT,
  choices_json TEXT NOT NULL,     -- [choiceIndex, ...]
  weight TEXT NOT NULL,           -- u128 veHNT (native units) as a string
  flipped INTEGER NOT NULL DEFAULT 0,       -- 1 if the position changed its vote choice
  flip_resolved INTEGER NOT NULL DEFAULT 0, -- 1 once the flip resolver decoded this marker's history
  PRIMARY KEY (proposal, marker)
);
CREATE INDEX IF NOT EXISTS idx_vote_events_proposal_ts ON vote_events (proposal, ts);
CREATE INDEX IF NOT EXISTS idx_vote_events_unresolved ON vote_events (proposal, flip_resolved);

-- Vote tool: durable per-proposal catalog behind GET /vote/proposals (the index
-- page of current + past votes). One compact row per tracked proposal, upserted
-- on every snapshot refresh; settled (resolved/cancelled) rows stop changing.
-- Self-provisions via CREATE TABLE IF NOT EXISTS (no manual migration).
CREATE TABLE IF NOT EXISTS vote_proposals (
  address TEXT PRIMARY KEY,       -- ProposalV0 account pubkey
  name TEXT,
  status TEXT NOT NULL,           -- derived UI status (active/passed/failed/completed/…)
  state TEXT NOT NULL,            -- raw on-chain state kind (voting/resolved/…)
  created_at INTEGER,             -- unix seconds
  start_ts INTEGER,               -- voting-open time, when known
  end_ts INTEGER,                 -- actual end (resolved) or scheduled close (open)
  max_choices INTEGER,            -- ProposalV0.max_choices_per_voter
  seats INTEGER,                  -- election winners (ResolutionNode Top{n}); null for yes/no
  total_weight TEXT,              -- u128 sum of choice weights (native units) as a string
  total_ve_hnt REAL,              -- same in human veHNT (multi-choice counts a ballot once per chosen candidate)
  voted_ve_hnt REAL,              -- distinct participating veHNT (each position counted once)
  unique_voters INTEGER,
  winning_json TEXT,              -- [choiceIndex, ...] once resolved
  choices_json TEXT,              -- [{index,name,veHnt,percent}, ...] summary for cards
  tags_json TEXT,                 -- ["HIP 149", ...]
  updated_at INTEGER NOT NULL     -- ms timestamp of the upserting snapshot
);
