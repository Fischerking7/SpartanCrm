CREATE TABLE IF NOT EXISTS "carry_forward_balances" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "amount_cents" integer NOT NULL,
  "remaining_amount_cents" integer NOT NULL,
  "status" varchar DEFAULT 'PENDING' NOT NULL,
  "origin_pay_run_id" varchar REFERENCES "pay_runs"("id"),
  "origin_pay_statement_id" varchar REFERENCES "pay_statements"("id"),
  "resolved_pay_statement_id" varchar REFERENCES "pay_statements"("id"),
  "notes" text,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "cf_user_status_idx" ON "carry_forward_balances" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "cf_origin_payrun_idx" ON "carry_forward_balances" ("origin_pay_run_id");
