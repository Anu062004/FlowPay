CREATE TABLE IF NOT EXISTS investment_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  protocol VARCHAR(50) NOT NULL DEFAULT 'aave-v3-sepolia',
  amount_deposited NUMERIC(18,6) NOT NULL,
  atoken_balance NUMERIC(18,6) NOT NULL DEFAULT 0,
  yield_earned NUMERIC(18,6) NOT NULL DEFAULT 0,
  entry_price NUMERIC(18,6),
  tx_hash VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'liquidated')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_investment_positions_company ON investment_positions(company_id);
CREATE INDEX idx_investment_positions_status ON investment_positions(status);
