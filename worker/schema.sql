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

-- Council tool: one row per scraped Discord message (worker/src/tools/council),
-- keyed by (channel_id, message snowflake). A single table holds nominations,
-- supporting replies, and chatter (the `kind` column) — re-classification between
-- scrapes is a plain INSERT OR REPLACE. Support→nomination linking is resolved at
-- read time (reply_to_id walk), never persisted. `last_seen_at` = the scrapedAt of
-- the last push that carried the row; after a complete scrape, rows older than the
-- new scrapedAt are soft-removed (removed = 1). author_id/author_username are
-- nullable (default avatars carry no user id; the DOM shows a display name, not
-- always a @handle). The worker self-provisions this via CREATE TABLE IF NOT EXISTS
-- (no manual migration); it holds no Discord credentials and runs no cron.
CREATE TABLE IF NOT EXISTS council_messages (
  channel_id  TEXT NOT NULL,
  id          TEXT NOT NULL,            -- Discord message snowflake
  guild_id    TEXT NOT NULL,
  kind        TEXT NOT NULL,            -- 'nomination' | 'support' | 'other'
  reply_to_id TEXT,
  author_id           TEXT,             -- nullable: default avatars carry no user id
  author_username     TEXT,             -- @handle, nullable (display name is what DOM shows)
  author_display_name TEXT NOT NULL,
  avatar_url  TEXT,
  content     TEXT NOT NULL,
  posted_at   INTEGER NOT NULL,         -- ms epoch
  edited_at   INTEGER,
  reactions_json TEXT NOT NULL DEFAULT '[]',  -- [{ emoji, count }]
  removed     INTEGER NOT NULL DEFAULT 0,      -- 1 once a complete scrape stops carrying it
  last_seen_at INTEGER NOT NULL,               -- scrapedAt of the last push carrying this row
  PRIMARY KEY (channel_id, id)
);
CREATE INDEX IF NOT EXISTS idx_council_messages_live
  ON council_messages (channel_id, removed, posted_at);
