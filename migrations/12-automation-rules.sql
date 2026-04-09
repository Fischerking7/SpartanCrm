DO $$ BEGIN
  CREATE TYPE automation_rule_type AS ENUM (
    'AUTO_APPROVE_ORDER',
    'AUTO_POST_IMPORT',
    'AUTO_PAYROLL_READY',
    'ALERT_ON_EXCEPTION',
    'ESCALATE_AFTER_DAYS'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS automation_rules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  description TEXT,
  rule_type automation_rule_type NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  conditions JSONB NOT NULL DEFAULT '[]',
  actions JSONB NOT NULL DEFAULT '[]',
  created_by_user_id VARCHAR REFERENCES users(id),
  last_triggered_at TIMESTAMP,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
