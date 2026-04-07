DO $$ BEGIN
  CREATE TYPE capture_method AS ENUM ('manual', 'screenshot_capture');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS capture_method capture_method DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS capture_image_url text,
  ADD COLUMN IF NOT EXISTS capture_raw_json jsonb;
