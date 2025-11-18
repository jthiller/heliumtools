CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  verified INTEGER NOT NULL DEFAULT 0,
  verify_token TEXT,
  verify_expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  escrow_account TEXT NOT NULL,
  label TEXT,
  webhook_url TEXT,
  created_at TEXT NOT NULL,
  last_notified_level INTEGER NOT NULL DEFAULT 0,
  last_balance_dc REAL,
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
