-- Social Security Information Table
CREATE TABLE IF NOT EXISTS social_security (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  
  -- Personal Info
  birth_date DATE NOT NULL,
  full_retirement_age INTEGER, -- in months (e.g., 67 years = 804 months)
  
  -- Benefit Estimates (monthly amounts)
  benefit_age_62 DECIMAL(10,2),
  benefit_age_63 DECIMAL(10,2),
  benefit_age_64 DECIMAL(10,2),
  benefit_age_65 DECIMAL(10,2),
  benefit_age_66 DECIMAL(10,2),
  benefit_age_67 DECIMAL(10,2),
  benefit_age_68 DECIMAL(10,2),
  benefit_age_69 DECIMAL(10,2),
  benefit_age_70 DECIMAL(10,2),
  
  -- Primary Insurance Amount (benefit at FRA)
  primary_insurance_amount DECIMAL(10,2),
  
  -- Disability & Survivor Benefits
  disability_benefit DECIMAL(10,2),
  survivor_benefit DECIMAL(10,2),
  
  -- Medicare Eligibility
  medicare_credits INTEGER DEFAULT 0, -- Need 40 credits to qualify
  medicare_eligible BOOLEAN DEFAULT FALSE,
  
  -- Totals paid into system
  total_social_security_paid DECIMAL(12,2) DEFAULT 0,
  total_medicare_paid DECIMAL(12,2) DEFAULT 0,
  total_employer_ss_paid DECIMAL(12,2) DEFAULT 0,
  total_employer_medicare_paid DECIMAL(12,2) DEFAULT 0,
  
  -- Source of data
  data_source VARCHAR(50) DEFAULT 'manual', -- 'manual', 'statement_parse', 'projection'
  statement_date DATE, -- Date of SS statement if parsed
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(client_id)
);

-- Earnings History Table (year by year)
CREATE TABLE IF NOT EXISTS social_security_earnings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  
  work_year INTEGER NOT NULL,
  taxed_social_security_earnings DECIMAL(12,2) DEFAULT 0,
  taxed_medicare_earnings DECIMAL(12,2) DEFAULT 0,
  
  -- Employee contributions
  social_security_tax_paid DECIMAL(10,2) DEFAULT 0,
  medicare_tax_paid DECIMAL(10,2) DEFAULT 0,
  
  -- Employer contributions (matching)
  employer_ss_paid DECIMAL(10,2) DEFAULT 0,
  employer_medicare_paid DECIMAL(10,2) DEFAULT 0,
  
  -- Credits earned this year (max 4 per year)
  credits_earned INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(client_id, work_year)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_social_security_client ON social_security(client_id);
CREATE INDEX IF NOT EXISTS idx_ss_earnings_client ON social_security_earnings(client_id);
CREATE INDEX IF NOT EXISTS idx_ss_earnings_year ON social_security_earnings(work_year);

-- Update trigger
CREATE OR REPLACE FUNCTION update_social_security_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS social_security_updated ON social_security;
CREATE TRIGGER social_security_updated
  BEFORE UPDATE ON social_security
  FOR EACH ROW
  EXECUTE FUNCTION update_social_security_timestamp();
