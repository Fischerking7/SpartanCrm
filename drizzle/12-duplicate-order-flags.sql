ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS is_duplicate_flag boolean NOT NULL DEFAULT false;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS duplicate_flag_reason text;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS duplicate_of_order_id varchar;
