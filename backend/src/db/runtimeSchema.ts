import { db } from "./pool.js";
import { getDefaultSettlementChain } from "../utils/settlement.js";

export async function ensureRuntimeSchema() {
  const defaultSettlementChain = getDefaultSettlementChain();

  await db.query(`
    ALTER TYPE transaction_type
    ADD VALUE IF NOT EXISTS 'withdrawal'
  `);

  await db.query(`
    ALTER TYPE loan_status
    ADD VALUE IF NOT EXISTS 'pending_review'
  `);

  await db.query(`
    ALTER TYPE loan_status
    ADD VALUE IF NOT EXISTS 'expired'
  `);

  await db.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS email TEXT
  `);

  await db.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS access_pin_hash TEXT
  `);

  await db.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS recovery_token_hash TEXT
  `);

  await db.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS recovery_token_expires_at TIMESTAMPTZ
  `);

  await db.query(`
    ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS contract_signer_wallet_id UUID REFERENCES wallets(id)
  `);

  await db.query(`
    ALTER TABLE wallets
    ALTER COLUMN chain SET DEFAULT '${defaultSettlementChain}'
  `);

  await db.query(`
    UPDATE companies
    SET email = CONCAT('company+', id::text, '@flowpay.local')
    WHERE email IS NULL
  `);

  await db.query(`
    ALTER TABLE companies
    ALTER COLUMN email SET NOT NULL
  `);

  await db.query(`
    ALTER TABLE employees
    ALTER COLUMN company_id DROP NOT NULL
  `);

  await db.query(`
    ALTER TABLE employees
    ALTER COLUMN email DROP NOT NULL
  `);

  await db.query(`
    ALTER TABLE employees
    ALTER COLUMN salary SET DEFAULT 0
  `);

  await db.query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS recovery_token_hash TEXT
  `);

  await db.query(`
    ALTER TABLE employees
    ADD COLUMN IF NOT EXISTS recovery_token_expires_at TIMESTAMPTZ
  `);

  await db.query(`
    ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS contract_synced BOOLEAN NOT NULL DEFAULT false
  `);

  await db.query(`
    ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS contract_loan_id BIGINT
  `);

  await db.query(`
    ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ
  `);

  await db.query(`
    ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS review_expires_at TIMESTAMPTZ
  `);

  await db.query(`
    ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS review_reason TEXT
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
      agent_name TEXT NOT NULL,
      input_snapshot JSONB NOT NULL,
      decision JSONB NOT NULL,
      rationale TEXT,
      action_taken TEXT,
      company_id UUID REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  await db.query(`
    ALTER TABLE agent_logs
    ADD COLUMN IF NOT EXISTS workflow_id TEXT
  `);

  await db.query(`
    ALTER TABLE agent_logs
    ADD COLUMN IF NOT EXISTS workflow_name TEXT
  `);

  await db.query(`
    ALTER TABLE agent_logs
    ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'decision'
  `);

  await db.query(`
    ALTER TABLE agent_logs
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'backend'
  `);

  await db.query(`
    ALTER TABLE agent_logs
    ADD COLUMN IF NOT EXISTS policy_result JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await db.query(`
    ALTER TABLE agent_logs
    ADD COLUMN IF NOT EXISTS execution_status TEXT
  `);

  await db.query(`
    ALTER TABLE agent_logs
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(timestamp DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_logs_company_id ON agent_logs(company_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_agent_logs_workflow_id ON agent_logs(workflow_id)
  `);

  await db.query(`
    ALTER TABLE treasury_allocations
    ADD COLUMN IF NOT EXISTS main_reserve NUMERIC(18,6) NOT NULL DEFAULT 0
  `);

  await db.query(`
    ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS chain TEXT
  `);

  await db.query(`
    UPDATE transactions t
    SET chain = COALESCE(t.chain, w.chain, '${defaultSettlementChain}')
    FROM wallets w
    WHERE w.id = t.wallet_id
      AND (t.chain IS NULL OR LENGTH(TRIM(t.chain)) = 0)
  `);

  await db.query(`
    UPDATE transactions
    SET chain = '${defaultSettlementChain}'
    WHERE chain IS NULL OR LENGTH(TRIM(chain)) = 0
  `);

  await db.query(`
    ALTER TABLE transactions
    ALTER COLUMN chain SET DEFAULT '${defaultSettlementChain}'
  `);

  await db.query(`
    ALTER TABLE company_settings
    ADD COLUMN IF NOT EXISTS settlement JSONB
  `);

  await db.query(`
    UPDATE company_settings cs
    SET settlement = jsonb_build_object(
      'chain',
      COALESCE(NULLIF(TRIM(LOWER(w.chain)), ''), '${defaultSettlementChain}')
    )
    FROM companies c
    LEFT JOIN wallets w ON w.id = c.treasury_wallet_id
    WHERE c.id = cs.company_id
      AND cs.settlement IS NULL
  `);

  await db.query(`
    UPDATE company_settings
    SET settlement = jsonb_build_object('chain', '${defaultSettlementChain}')
    WHERE settlement IS NULL
  `);

  await db.query(`
    ALTER TABLE company_settings
    ALTER COLUMN settlement SET DEFAULT '{"chain":"${defaultSettlementChain}"}'::jsonb
  `);

  await db.query(`
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
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_company_month
      ON payroll_disbursements(company_id, payroll_month DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_employee_month
      ON payroll_disbursements(employee_id, payroll_month DESC)
  `);

  await db.query(`
    INSERT INTO payroll_disbursements
      (company_id, employee_id, payroll_month, gross_salary, net_salary, emi_deducted, tx_hash, created_at)
    SELECT DISTINCT ON (
      e.company_id,
      e.id,
      date_trunc('month', t.created_at AT TIME ZONE 'UTC')::date
    )
      e.company_id,
      e.id,
      date_trunc('month', t.created_at AT TIME ZONE 'UTC')::date AS payroll_month,
      t.amount,
      t.amount,
      0,
      t.tx_hash,
      t.created_at
    FROM transactions t
    JOIN wallets w ON w.id = t.wallet_id
    JOIN employees e ON e.wallet_id = w.id
    WHERE t.type = 'payroll'
      AND e.company_id IS NOT NULL
    ORDER BY
      e.company_id,
      e.id,
      date_trunc('month', t.created_at AT TIME ZONE 'UTC')::date,
      t.created_at DESC
    ON CONFLICT (company_id, employee_id, payroll_month) DO NOTHING
  `);
}
