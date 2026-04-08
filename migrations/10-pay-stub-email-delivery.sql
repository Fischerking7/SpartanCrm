-- Pay Stub Email Delivery (Task #23)
-- Adds email delivery tracking to pay statements and notification preferences

-- Add PAY_STUB_DELIVERY to notification_type enum
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'PAY_STUB_DELIVERY';

-- Add email delivery tracking columns to pay_statements
ALTER TABLE pay_statements ADD COLUMN IF NOT EXISTS email_delivery_status text DEFAULT 'PENDING';
ALTER TABLE pay_statements ADD COLUMN IF NOT EXISTS email_delivery_error text;
ALTER TABLE pay_statements ADD COLUMN IF NOT EXISTS email_sent_at timestamp;

-- Add pay stub email opt-out to notification preferences
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS email_pay_stub_delivery boolean DEFAULT true;
