import { db } from "./pool.js";

export async function ensureRuntimeSchema() {
  await db.query(`
    ALTER TYPE transaction_type
    ADD VALUE IF NOT EXISTS 'withdrawal'
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
    ALTER TABLE loans
    ADD COLUMN IF NOT EXISTS contract_synced BOOLEAN NOT NULL DEFAULT false
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
}
