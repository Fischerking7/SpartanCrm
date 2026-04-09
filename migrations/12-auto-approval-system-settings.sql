ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS auto_approval_attempted_at TIMESTAMP;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS auto_approval_result TEXT;

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_by_user_id VARCHAR REFERENCES users(id),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description) VALUES
  ('auto_approval_confidence_threshold', '80', 'Minimum confidence score (0-100) required for auto-approval')
  ON CONFLICT (key) DO NOTHING;

INSERT INTO system_settings (key, value, description) VALUES
  ('auto_approval_max_commission_cents', '0', 'Maximum base commission in cents allowed for auto-approval (0 = no limit)')
  ON CONFLICT (key) DO NOTHING;

INSERT INTO system_settings (key, value, description) VALUES
  ('auto_approval_chargeback_risk_max', '85', 'Maximum chargeback risk score allowed for auto-approval')
  ON CONFLICT (key) DO NOTHING;

INSERT INTO system_settings (key, value, description) VALUES
  ('auto_approval_enabled', 'true', 'Master switch to enable or disable the auto-approval sweep job')
  ON CONFLICT (key) DO NOTHING;
