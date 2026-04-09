-- Add simplified status and chargeback flag columns to sales_orders
-- These support the rep-facing dashboard: human-readable status labels and alert indicators
-- safe to run on existing data: all columns have defaults and are nullable or default-false

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS simplified_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS has_active_chargeback BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_disputed_chargeback BOOLEAN NOT NULL DEFAULT FALSE;
