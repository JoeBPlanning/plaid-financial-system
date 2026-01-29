-- Migration: Investment Accounts & Client Profile Enhancements
-- Supports manual statement imports with tax treatment categorization

-- Add birth_date to clients table
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS birth_date DATE,
ADD COLUMN IF NOT EXISTS retirement_age INTEGER DEFAULT 65;

-- Create client_partners table for spouse/partner info
CREATE TABLE IF NOT EXISTS client_partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  birth_date DATE,
  relationship TEXT DEFAULT 'spouse', -- spouse, partner, domestic_partner
  retirement_age INTEGER DEFAULT 65,
  social_security_id UUID REFERENCES social_security(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, name)
);

-- Create manual investment accounts table (from statements, not Plaid)
CREATE TABLE IF NOT EXISTS investment_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  partner_id UUID REFERENCES client_partners(id) ON DELETE SET NULL,
  
  -- Account identification (NO account numbers stored)
  account_nickname TEXT NOT NULL, -- User-friendly name like "John's 401k"
  custodian TEXT NOT NULL, -- Fidelity, Robinhood, Wealthfront, Vanguard, etc.
  account_type TEXT NOT NULL, -- 401k, 403b, IRA, Roth_IRA, brokerage, HYSA, HSA, 529, etc.
  
  -- Tax treatment categorization
  tax_treatment TEXT NOT NULL CHECK (tax_treatment IN ('taxable', 'tax_free', 'tax_deferred')),
  -- taxable: brokerage, HYSA (interest is taxed)
  -- tax_free: Roth IRA, Roth 401k, HSA (for medical), 529 (for education)
  -- tax_deferred: Traditional 401k, 403b, Traditional IRA
  
  -- Owner
  owner TEXT DEFAULT 'client', -- client, partner, joint
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(client_id, account_nickname)
);

-- Create account snapshots table (monthly balance tracking)
CREATE TABLE IF NOT EXISTS account_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES investment_accounts(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  
  -- Timing
  snapshot_date DATE NOT NULL,
  month_year TEXT NOT NULL, -- Format: YYYY-MM
  statement_date DATE, -- Actual date on the statement
  
  -- Balance
  total_balance DECIMAL(14,2) NOT NULL,
  
  -- Data source
  is_projected BOOLEAN DEFAULT false, -- true if growth was projected, false if from actual statement
  projection_rate DECIMAL(5,4), -- e.g., 0.09 for 9% annual
  source_statement TEXT, -- filename of the statement used
  
  -- Holdings detail (JSONB for flexibility)
  -- Format: [{"name": "FXAIX", "ticker": "FXAIX", "shares": 150.5, "price": 185.50, "value": 27917.75, "type": "mutual_fund"}, ...]
  holdings JSONB DEFAULT '[]',
  
  -- Summary by asset class
  -- Format: {"stocks": 50000, "bonds": 20000, "cash": 5000, "other": 1000}
  asset_allocation JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(account_id, snapshot_date)
);

-- Create view for total investments by tax treatment
CREATE OR REPLACE VIEW investment_summary_by_tax AS
SELECT 
  c.client_id,
  c.name as client_name,
  ia.tax_treatment,
  COUNT(DISTINCT ia.id) as account_count,
  SUM(latest.total_balance) as total_balance
FROM clients c
JOIN investment_accounts ia ON c.client_id = ia.client_id
LEFT JOIN LATERAL (
  SELECT total_balance 
  FROM account_snapshots 
  WHERE account_id = ia.id 
  ORDER BY snapshot_date DESC 
  LIMIT 1
) latest ON true
WHERE ia.is_active = true
GROUP BY c.client_id, c.name, ia.tax_treatment;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_client_partners_client_id ON client_partners(client_id);
CREATE INDEX IF NOT EXISTS idx_investment_accounts_client_id ON investment_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_investment_accounts_tax_treatment ON investment_accounts(tax_treatment);
CREATE INDEX IF NOT EXISTS idx_investment_accounts_custodian ON investment_accounts(custodian);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_account_id ON account_snapshots(account_id);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_client_id ON account_snapshots(client_id);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_date ON account_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_month_year ON account_snapshots(month_year);

-- Triggers
CREATE TRIGGER update_client_partners_updated_at BEFORE UPDATE ON client_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_investment_accounts_updated_at BEFORE UPDATE ON investment_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_account_snapshots_updated_at BEFORE UPDATE ON account_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Helper: Tax treatment reference
COMMENT ON COLUMN investment_accounts.tax_treatment IS 
'taxable: brokerage, HYSA (interest taxed annually)
tax_free: Roth IRA, Roth 401k, HSA (medical), 529 (education) - qualified withdrawals tax-free
tax_deferred: Traditional 401k, 403b, Traditional IRA - taxed on withdrawal';
