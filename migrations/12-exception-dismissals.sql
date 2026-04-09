CREATE TABLE IF NOT EXISTS "exception_dismissals" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "exception_type" varchar NOT NULL,
  "entity_id" varchar NOT NULL,
  "dismissed_by_user_id" varchar NOT NULL REFERENCES "users"("id"),
  "reason" text,
  "snoozed_until" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "exc_dismiss_type_entity_idx"
  ON "exception_dismissals" ("exception_type", "entity_id");

CREATE INDEX IF NOT EXISTS "exc_dismiss_user_idx"
  ON "exception_dismissals" ("dismissed_by_user_id");
