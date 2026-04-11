DO $$ BEGIN
  CREATE TYPE rep_message_category AS ENUM ('COMMISSION_QUESTION', 'PAY_QUESTION', 'ORDER_ISSUE', 'GENERAL', 'CHARGEBACK_QUESTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS rep_messages (
  id SERIAL PRIMARY KEY,
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  to_user_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  category rep_message_category DEFAULT 'GENERAL',
  related_entity_type TEXT,
  related_entity_id INTEGER,
  parent_message_id INTEGER REFERENCES rep_messages(id),
  is_read BOOLEAN DEFAULT FALSE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rep_messages_to_user ON rep_messages(to_user_id);
CREATE INDEX IF NOT EXISTS idx_rep_messages_from_user ON rep_messages(from_user_id);
CREATE INDEX IF NOT EXISTS idx_rep_messages_parent ON rep_messages(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_rep_messages_created ON rep_messages(created_at);
