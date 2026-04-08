ALTER TABLE pay_statements ADD COLUMN IF NOT EXISTS "reserve_previous_balance" numeric;
ALTER TABLE pay_statements ADD COLUMN IF NOT EXISTS "reserve_chargebacks_offset" numeric;
ALTER TABLE pay_statements ADD COLUMN IF NOT EXISTS "reserve_cap_amount" numeric;
ALTER TABLE pay_statements ADD COLUMN IF NOT EXISTS "reserve_status_label" text;

ALTER TABLE pay_statement_line_items ADD COLUMN IF NOT EXISTS "net_amount" numeric;
ALTER TABLE pay_statement_line_items ADD COLUMN IF NOT EXISTS "reserve_withheld_for_order" numeric;
ALTER TABLE pay_statement_line_items ADD COLUMN IF NOT EXISTS "chargeback_source" text;
ALTER TABLE pay_statement_line_items ADD COLUMN IF NOT EXISTS "chargeback_from_reserve_cents" integer;
ALTER TABLE pay_statement_line_items ADD COLUMN IF NOT EXISTS "chargeback_from_net_pay_cents" integer;
