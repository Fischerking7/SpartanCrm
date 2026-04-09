-- Migration: Add saved_reports table for admin report configurations
CREATE TABLE IF NOT EXISTS "saved_reports" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_by_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "name" varchar(255) NOT NULL,
  "report_type" varchar(100) NOT NULL,
  "params_json" jsonb NOT NULL DEFAULT '{}',
  "is_shared" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "saved_reports_created_by_user_id_idx" ON "saved_reports"("created_by_user_id");
CREATE INDEX IF NOT EXISTS "saved_reports_is_shared_idx" ON "saved_reports"("is_shared");
