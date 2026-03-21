CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE wallet_owner_type AS ENUM ('company', 'employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE loan_status AS ENUM ('pending', 'active', 'repaid', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM (
    'deposit',
  'payroll',
  'loan_disbursement',
  'emi_repayment',
  'withdrawal',
  'investment',
  'treasury_allocation'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type wallet_owner_type NOT NULL,
  owner_id UUID NOT NULL,
  wallet_address TEXT NOT NULL,
  wallet_id TEXT NOT NULL,
  encrypted_seed TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'sepolia',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  access_pin_hash TEXT,
  recovery_token_hash TEXT,
  recovery_token_expires_at TIMESTAMPTZ,
  treasury_wallet_id UUID REFERENCES wallets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES wallets(id),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  salary NUMERIC(18,6) NOT NULL DEFAULT 0,
  credit_score INTEGER NOT NULL DEFAULT 600,
  activation_token TEXT,
  password_hash TEXT,
  recovery_token_hash TEXT,
  recovery_token_expires_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount NUMERIC(18,6) NOT NULL,
  interest_rate NUMERIC(5,2) NOT NULL,
  duration_months INTEGER NOT NULL,
  remaining_balance NUMERIC(18,6) NOT NULL,
  status loan_status NOT NULL DEFAULT 'pending',
  contract_synced BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  type transaction_type NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  tx_hash TEXT,
  token_symbol TEXT NOT NULL DEFAULT 'ETH',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treasury_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_reserve NUMERIC(18,6) NOT NULL,
  lending_pool NUMERIC(18,6) NOT NULL,
  investment_pool NUMERIC(18,6) NOT NULL,
  main_reserve NUMERIC(18,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  payroll_month DATE NOT NULL,
  gross_salary NUMERIC(18,6) NOT NULL,
  net_salary NUMERIC(18,6) NOT NULL,
  emi_deducted NUMERIC(18,6) NOT NULL DEFAULT 0,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, payroll_month)
);

CREATE TABLE IF NOT EXISTS company_settings (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  profile JSONB NOT NULL,
  payroll JSONB NOT NULL,
  security JSONB NOT NULL,
  agent JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  recipient_email TEXT,
  subject TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  approval_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ops_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  task_id UUID REFERENCES ops_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  decision_payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_name TEXT NOT NULL,
  input_snapshot JSONB NOT NULL,
  decision JSONB NOT NULL,
  rationale TEXT,
  action_taken TEXT,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  workflow_id TEXT,
  workflow_name TEXT,
  stage TEXT NOT NULL DEFAULT 'decision',
  source TEXT NOT NULL DEFAULT 'backend',
  policy_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  execution_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ops_tasks_status ON ops_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_company ON ops_tasks(company_id);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_type ON ops_tasks(type);
CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_company_month
  ON payroll_disbursements(company_id, payroll_month DESC);
CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_employee_month
  ON payroll_disbursements(employee_id, payroll_month DESC);
CREATE INDEX IF NOT EXISTS idx_ops_approvals_status ON ops_approvals(status);
CREATE INDEX IF NOT EXISTS idx_ops_approvals_company ON ops_approvals(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_company_id ON agent_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_workflow_id ON agent_logs(workflow_id);
