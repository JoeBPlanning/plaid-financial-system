-- Paystub Information Table
CREATE TABLE IF NOT EXISTS paystubs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  
  -- Pay Period Info
  period_beginning DATE,
  period_ending DATE NOT NULL,
  pay_date DATE,
  pay_frequency VARCHAR(20), -- 'biweekly', 'semimonthly', 'monthly', 'weekly'
  pay_periods_per_year INTEGER,
  
  -- Earnings - This Period
  regular_pay DECIMAL(10,2) DEFAULT 0,
  overtime_pay DECIMAL(10,2) DEFAULT 0,
  holiday_pay DECIMAL(10,2) DEFAULT 0,
  vacation_pay DECIMAL(10,2) DEFAULT 0,
  sick_pay DECIMAL(10,2) DEFAULT 0,
  bonus_pay DECIMAL(10,2) DEFAULT 0,
  commission_pay DECIMAL(10,2) DEFAULT 0,
  fringe_benefits DECIMAL(10,2) DEFAULT 0,
  other_earnings DECIMAL(10,2) DEFAULT 0,
  gross_pay DECIMAL(10,2) DEFAULT 0,
  
  -- Earnings - Year to Date
  regular_pay_ytd DECIMAL(12,2) DEFAULT 0,
  overtime_pay_ytd DECIMAL(12,2) DEFAULT 0,
  holiday_pay_ytd DECIMAL(12,2) DEFAULT 0,
  vacation_pay_ytd DECIMAL(12,2) DEFAULT 0,
  sick_pay_ytd DECIMAL(12,2) DEFAULT 0,
  bonus_pay_ytd DECIMAL(12,2) DEFAULT 0,
  commission_pay_ytd DECIMAL(12,2) DEFAULT 0,
  fringe_benefits_ytd DECIMAL(12,2) DEFAULT 0,
  other_earnings_ytd DECIMAL(12,2) DEFAULT 0,
  gross_pay_ytd DECIMAL(12,2) DEFAULT 0,
  
  -- Statutory Deductions - This Period
  federal_income_tax DECIMAL(10,2) DEFAULT 0,
  social_security_tax DECIMAL(10,2) DEFAULT 0,
  medicare_tax DECIMAL(10,2) DEFAULT 0,
  state_income_tax DECIMAL(10,2) DEFAULT 0,
  local_income_tax DECIMAL(10,2) DEFAULT 0,
  
  -- Statutory Deductions - YTD
  federal_income_tax_ytd DECIMAL(12,2) DEFAULT 0,
  social_security_tax_ytd DECIMAL(12,2) DEFAULT 0,
  medicare_tax_ytd DECIMAL(12,2) DEFAULT 0,
  state_income_tax_ytd DECIMAL(12,2) DEFAULT 0,
  local_income_tax_ytd DECIMAL(12,2) DEFAULT 0,
  
  -- Pre-Tax Deductions (JSONB for flexibility)
  -- Format: {"dental": {"current": 5.50, "ytd": 126.50}, "401k": {"current": 230.77, "ytd": 6203.64}, ...}
  pretax_deductions JSONB DEFAULT '{}',
  
  -- After-Tax Deductions (JSONB for flexibility)
  -- Format: {"roth_401k": {"current": 461.54, "ytd": 2538.47}, "vol_life_insurance": {"current": 9, "ytd": 207}, ...}
  aftertax_deductions JSONB DEFAULT '{}',
  
  -- Pre-Tax Totals (for easy querying)
  pretax_total DECIMAL(10,2) DEFAULT 0,
  pretax_total_ytd DECIMAL(12,2) DEFAULT 0,
  
  -- After-Tax Totals (for easy querying)
  aftertax_total DECIMAL(10,2) DEFAULT 0,
  aftertax_total_ytd DECIMAL(12,2) DEFAULT 0,
  
  -- Employer Contributions
  employer_401k_match DECIMAL(10,2) DEFAULT 0,
  employer_401k_match_ytd DECIMAL(12,2) DEFAULT 0,
  employer_hsa DECIMAL(10,2) DEFAULT 0,
  employer_hsa_ytd DECIMAL(12,2) DEFAULT 0,
  employer_health_insurance DECIMAL(10,2) DEFAULT 0,
  employer_health_insurance_ytd DECIMAL(12,2) DEFAULT 0,
  
  -- Net Pay
  net_pay DECIMAL(10,2) DEFAULT 0,
  net_pay_ytd DECIMAL(12,2) DEFAULT 0,
  
  -- Calculated Projections
  estimated_annual_gross DECIMAL(12,2),
  estimated_annual_federal_tax DECIMAL(12,2),
  estimated_annual_state_tax DECIMAL(12,2),
  estimated_annual_fica DECIMAL(12,2),
  remaining_pay_periods INTEGER,
  
  -- Metadata
  tax_year INTEGER NOT NULL,
  employer_name VARCHAR(255),
  filing_status VARCHAR(50),
  state VARCHAR(2),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_paystubs_client ON paystubs(client_id);
CREATE INDEX IF NOT EXISTS idx_paystubs_year ON paystubs(tax_year);
CREATE INDEX IF NOT EXISTS idx_paystubs_period ON paystubs(period_ending);

-- Update trigger
CREATE OR REPLACE FUNCTION update_paystubs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS paystubs_updated ON paystubs;
CREATE TRIGGER paystubs_updated
  BEFORE UPDATE ON paystubs
  FOR EACH ROW
  EXECUTE FUNCTION update_paystubs_timestamp();
