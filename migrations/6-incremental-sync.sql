-- Add woStatus and rowHash to processed_work_orders for incremental sync detection
ALTER TABLE processed_work_orders ADD COLUMN IF NOT EXISTS wo_status TEXT;
ALTER TABLE processed_work_orders ADD COLUMN IF NOT EXISTS row_hash TEXT;

-- Add incremental sync tracking fields to install_sync_runs
ALTER TABLE install_sync_runs ADD COLUMN IF NOT EXISTS new_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE install_sync_runs ADD COLUMN IF NOT EXISTS changed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE install_sync_runs ADD COLUMN IF NOT EXISTS unchanged_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE install_sync_runs ADD COLUMN IF NOT EXISTS is_incremental BOOLEAN NOT NULL DEFAULT FALSE;

-- Performance indexes for install sync matching
CREATE INDEX IF NOT EXISTS idx_sales_orders_account_number ON sales_orders (account_number);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_name ON sales_orders (customer_name);
CREATE INDEX IF NOT EXISTS idx_processed_wo_work_order_number ON processed_work_orders (work_order_number);
CREATE INDEX IF NOT EXISTS idx_processed_wo_carrier_profile ON processed_work_orders (carrier_profile_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_job_status ON sales_orders (job_status);
