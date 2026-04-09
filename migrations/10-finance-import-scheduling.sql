-- Migration: Finance import scheduling, match corrections, system settings
-- Task #4: Learning-based match corrections, configurable thresholds, schedule tracking

CREATE TYPE IF NOT EXISTS "public"."match_correction_type" AS ENUM('MANUAL_MATCH', 'MANUAL_UNMATCH', 'MANUAL_IGNORE');

CREATE TYPE IF NOT EXISTS "public"."finance_import_schedule_frequency" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE IF NOT EXISTS "system_settings" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "description" text,
  "updated_by_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "system_settings_key_unique" UNIQUE("key")
);

CREATE TABLE IF NOT EXISTS "match_corrections" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "finance_import_id" varchar NOT NULL REFERENCES "finance_imports"("id") ON DELETE CASCADE,
  "finance_import_row_id" varchar NOT NULL REFERENCES "finance_import_rows"("id") ON DELETE CASCADE,
  "correction_type" "match_correction_type" NOT NULL,
  "original_matched_order_id" varchar REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "corrected_matched_order_id" varchar REFERENCES "sales_orders"("id") ON DELETE SET NULL,
  "score_at_correction" integer,
  "name_overlap_score" integer,
  "date_diff_days" integer,
  "amount_diff_cents" integer,
  "corrected_by_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "match_corrections_import_idx" ON "match_corrections" ("finance_import_id");
CREATE INDEX IF NOT EXISTS "match_corrections_row_idx" ON "match_corrections" ("finance_import_row_id");

CREATE TABLE IF NOT EXISTS "finance_import_schedules" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" varchar NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "frequency" "finance_import_schedule_frequency" DEFAULT 'MONTHLY' NOT NULL,
  "day_of_month" integer,
  "day_of_week" integer,
  "expected_by_days_after_period" integer DEFAULT 7 NOT NULL,
  "last_imported_at" timestamp,
  "next_expected_at" timestamp,
  "is_active" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_by_user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "finance_import_schedules_client_idx" ON "finance_import_schedules" ("client_id");
CREATE INDEX IF NOT EXISTS "finance_import_schedules_active_idx" ON "finance_import_schedules" ("is_active");
