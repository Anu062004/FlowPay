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

CREATE INDEX IF NOT EXISTS idx_agent_logs_timestamp ON agent_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_company_id ON agent_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_logs_workflow_id ON agent_logs(workflow_id);
