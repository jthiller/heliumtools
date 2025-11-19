-- Migration number: 0001 	 2024-11-19T00:00:00.000Z
ALTER TABLE users ADD COLUMN uuid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
