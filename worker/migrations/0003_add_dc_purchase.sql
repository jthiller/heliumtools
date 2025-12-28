-- Migration to add dc_purchase_orders and dc_purchase_events tables
CREATE TABLE IF NOT EXISTS dc_purchase_orders (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  oui INTEGER NOT NULL,
  payer TEXT NOT NULL,
  escrow TEXT NOT NULL,
  usd_requested TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL,
  coinbase_partner_user_ref TEXT NOT NULL UNIQUE,
  coinbase_transaction_id TEXT,
  usdc_amount_received TEXT,
  usdc_signature TEXT,
  hnt_amount_received TEXT,
  jupiter_quote_json TEXT,
  swap_tx_sig TEXT,
  mint_tx_sigs TEXT,
  delegate_tx_sig TEXT,
  dc_delegated TEXT,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_dc_orders_status ON dc_purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_dc_orders_created_at ON dc_purchase_orders(created_at);
CREATE INDEX IF NOT EXISTS idx_dc_orders_coinbase_tx ON dc_purchase_orders(coinbase_transaction_id);

CREATE TABLE IF NOT EXISTS dc_purchase_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  FOREIGN KEY (order_id) REFERENCES dc_purchase_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dc_events_order_created_at ON dc_purchase_events(order_id, created_at);
