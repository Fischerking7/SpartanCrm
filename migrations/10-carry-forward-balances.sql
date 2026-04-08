CREATE TABLE IF NOT EXISTS "carry_forward_balances" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar NOT NULL REFERENCES "users"("id"),
  "amount_cents" integer NOT NULL,
  "remaining_amount_cents" integer NOT NULL,
  "status" varchar(20) DEFAULT 'PENDING' NOT NULL,
  "origin_pay_run_id" varchar NOT NULL REFERENCES "pay_runs"("id"),
  "origin_pay_statement_id" varchar NOT NULL REFERENCES "pay_statements"("id"),
  "resolved_pay_statement_id" varchar REFERENCES "pay_statements"("id"),
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cf_bal_user_id_idx" ON "carry_forward_balances" ("user_id");
CREATE INDEX IF NOT EXISTS "cf_bal_status_idx" ON "carry_forward_balances" ("status");
CREATE INDEX IF NOT EXISTS "cf_bal_origin_payrun_idx" ON "carry_forward_balances" ("origin_pay_run_id");
