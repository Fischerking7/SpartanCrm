DO $$ BEGIN
  CREATE TYPE rep_message_category AS ENUM ('COMMISSION_INQUIRY', 'PAY_QUESTION', 'GENERAL', 'SCHEDULE', 'COMPLIANCE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS rep_messages (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id VARCHAR NOT NULL REFERENCES users(id),
  to_user_id VARCHAR NOT NULL REFERENCES users(id),
  parent_message_id VARCHAR,
  category rep_message_category NOT NULL DEFAULT 'GENERAL',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  related_entity_type VARCHAR(30),
  related_entity_id VARCHAR,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_messages_to_user ON rep_messages(to_user_id);
CREATE INDEX IF NOT EXISTS idx_rep_messages_from_user ON rep_messages(from_user_id);
CREATE INDEX IF NOT EXISTS idx_rep_messages_parent ON rep_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_rep_messages_created ON rep_messages(created_at);
