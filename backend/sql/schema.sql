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
  treasury_wallet_id UUID REFERENCES wallets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  wallet_id UUID REFERENCES wallets(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  salary NUMERIC(18,6) NOT NULL,
  credit_score INTEGER NOT NULL DEFAULT 600,
  activation_token TEXT,
  password_hash TEXT,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  type transaction_type NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS treasury_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  payroll_reserve NUMERIC(18,6) NOT NULL,
  lending_pool NUMERIC(18,6) NOT NULL,
  investment_pool NUMERIC(18,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
