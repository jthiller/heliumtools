-- Add last_webhook_date column to track daily webhook sends
ALTER TABLE subscriptions ADD COLUMN last_webhook_date TEXT;
