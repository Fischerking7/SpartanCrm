-- Add document expiration tracking fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS contractor_agreement_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nda_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS background_check_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS drug_test_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_blocked_due_to_expiry BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_blocked_reason TEXT;

-- Add escalation and legal hold fields to commission_disputes
-- First update enum to add new values
ALTER TYPE commission_dispute_status ADD VALUE IF NOT EXISTS 'ESCALATED';
ALTER TYPE commission_dispute_status ADD VALUE IF NOT EXISTS 'LEGAL_HOLD';

ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS escalation_threshold_amount DECIMAL(10,2);
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP;
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS escalated_by_user_id VARCHAR REFERENCES users(id);
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS legal_hold_at TIMESTAMP;
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS legal_hold_by_user_id VARCHAR REFERENCES users(id);
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS legal_hold_reason TEXT;
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS legal_hold_released_at TIMESTAMP;
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS legal_hold_released_by_user_id VARCHAR REFERENCES users(id);
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS commission_frozen BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE commission_disputes ADD COLUMN IF NOT EXISTS auto_escalated BOOLEAN NOT NULL DEFAULT FALSE;

-- Create dispute escalation events table (timeline)
CREATE TABLE IF NOT EXISTS dispute_escalation_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id VARCHAR NOT NULL REFERENCES commission_disputes(id) ON DELETE CASCADE,
  actor_user_id VARCHAR REFERENCES users(id),
  event_type VARCHAR(50) NOT NULL,
  from_status VARCHAR(30),
  to_status VARCHAR(30),
  note TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Create dispute evidence attachments table
CREATE TABLE IF NOT EXISTS dispute_evidence_attachments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id VARCHAR NOT NULL REFERENCES commission_disputes(id) ON DELETE CASCADE,
  uploaded_by_user_id VARCHAR NOT NULL REFERENCES users(id),
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  storage_key TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Contractor document version history (immutable audit trail for re-signs)
CREATE TABLE IF NOT EXISTS contractor_document_versions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  document_type VARCHAR(50) NOT NULL,
  event_type VARCHAR(30) NOT NULL,
  expires_at TIMESTAMP,
  signed_at TIMESTAMP,
  performed_by_user_id VARCHAR REFERENCES users(id),
  note TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Re-certification requests
CREATE TABLE IF NOT EXISTS recertification_requests (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR NOT NULL REFERENCES users(id),
  document_types TEXT[] NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_by_user_id VARCHAR REFERENCES users(id),
  request_note TEXT,
  completed_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL
);
