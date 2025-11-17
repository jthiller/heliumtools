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
