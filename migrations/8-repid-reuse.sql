-- Allow reuse of rep_id values when users are soft-deleted
-- Replace the absolute unique constraint with a partial unique index
-- that only enforces uniqueness among non-deleted users

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rep_id_unique;

CREATE UNIQUE INDEX IF NOT EXISTS users_rep_id_active_unique ON users (rep_id) WHERE deleted_at IS NULL;
