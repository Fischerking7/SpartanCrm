-- Add DIRECTOR and OPERATIONS to source_level enum
DO $$ BEGIN
  ALTER TYPE source_level ADD VALUE IF NOT EXISTS 'DIRECTOR';
  ALTER TYPE source_level ADD VALUE IF NOT EXISTS 'OPERATIONS';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add comp_plan_type enum
DO $$ BEGIN
  CREATE TYPE comp_plan_type AS ENUM ('STANDARD', 'ELEVATED', 'OWNER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add owner_pool_group enum
DO $$ BEGIN
  CREATE TYPE owner_pool_group AS ENUM ('PMG_OWNERS', 'OWNER_POOL_1');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add comp_plan_column enum
DO $$ BEGIN
  CREATE TYPE comp_plan_column AS ENUM ('REP_B', 'LEADER_C', 'MANAGER_D', 'DIRECTOR_E', 'OPERATIONS_F', 'ACCOUNTING_G', 'EXECUTIVE_H', 'IC_PROFIT_I', 'ELEVATED_J');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add override_rule_type enum
DO $$ BEGIN
  CREATE TYPE override_rule_type AS ENUM ('DIRECTOR_OVERRIDE', 'MANAGER_OVERRIDE', 'OPERATIONS_OVERRIDE', 'ACCOUNTING_OVERRIDE', 'LEADER_OVERRIDE', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add comp_plan_type and owner_pool_group to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS comp_plan_type varchar(20) NOT NULL DEFAULT 'STANDARD';
ALTER TABLE users ADD COLUMN IF NOT EXISTS owner_pool_group varchar(50);

-- Create comp_plan_rates table
CREATE TABLE IF NOT EXISTS comp_plan_rates (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id varchar REFERENCES services(id),
  provider_id varchar REFERENCES providers(id),
  client_id varchar REFERENCES clients(id),
  speed_tier_label varchar(100),
  rep_rate_cents integer NOT NULL DEFAULT 0,
  leader_rate_cents integer NOT NULL DEFAULT 0,
  manager_rate_cents integer NOT NULL DEFAULT 0,
  director_override_cents integer NOT NULL DEFAULT 0,
  operations_override_cents integer NOT NULL DEFAULT 0,
  accounting_override_cents integer NOT NULL DEFAULT 0,
  executive_pay_cents integer NOT NULL DEFAULT 0,
  ic_profit_cents integer NOT NULL DEFAULT 0,
  elevated_personal_sales_cents integer NOT NULL DEFAULT 0,
  effective_start date NOT NULL DEFAULT '2025-01-01',
  effective_end date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);

-- Create commission_override_rules table
CREATE TABLE IF NOT EXISTS commission_override_rules (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name varchar(200) NOT NULL,
  recipient_user_id varchar REFERENCES users(id),
  recipient_role user_role,
  override_type override_rule_type NOT NULL,
  override_column varchar(10) NOT NULL,
  flat_amount_cents integer,
  use_comp_plan_column boolean NOT NULL DEFAULT true,
  min_speed_mbps integer,
  exclude_owner_sales boolean NOT NULL DEFAULT false,
  exclude_self_sales boolean NOT NULL DEFAULT false,
  exclude_own_team_sales boolean NOT NULL DEFAULT false,
  reduced_amount_reps jsonb,
  exclude_rep_ids jsonb,
  include_rep_ids jsonb,
  include_owner_sales boolean NOT NULL DEFAULT false,
  applies_to_all_sales boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp DEFAULT now() NOT NULL,
  updated_at timestamp DEFAULT now() NOT NULL
);
