-- ================================================
-- Social Security Data Table Migration
-- ================================================
-- Purpose: Store Social Security benefit estimates and calculations for retirement planning
-- Created: 2025-01-04

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create social_security_data table
CREATE TABLE IF NOT EXISTS social_security_data (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Personal Information
  date_of_birth DATE NOT NULL,
  full_retirement_age INTEGER DEFAULT 67 CHECK (full_retirement_age BETWEEN 65 AND 67),

  -- Benefit Estimates (monthly amounts in USD)
  benefit_at_62 DECIMAL(10,2) CHECK (benefit_at_62 >= 0),
  benefit_at_fra DECIMAL(10,2) CHECK (benefit_at_fra >= 0),
  benefit_at_70 DECIMAL(10,2) CHECK (benefit_at_70 >= 0),

  -- Current Earnings Data
  current_annual_earnings DECIMAL(10,2) CHECK (current_annual_earnings >= 0),
  years_of_substantial_earnings INTEGER CHECK (years_of_substantial_earnings >= 0 AND years_of_substantial_earnings <= 60),

  -- Calculated Fields
  estimated_ssa_start_age INTEGER DEFAULT 67 CHECK (estimated_ssa_start_age BETWEEN 62 AND 70),
  estimated_monthly_benefit DECIMAL(10,2) CHECK (estimated_monthly_benefit >= 0),
  present_value_of_benefits DECIMAL(12,2) CHECK (present_value_of_benefits >= 0),

  -- Metadata
  last_updated DATE DEFAULT CURRENT_DATE,
  statement_upload_path TEXT,
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  UNIQUE(client_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_social_security_client_id ON social_security_data(client_id);

-- Enable Row Level Security
ALTER TABLE social_security_data ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view their own Social Security data
CREATE POLICY "Users view own SSA data" ON social_security_data
  FOR SELECT
  USING (auth.uid() = client_id);

-- RLS Policy: Users can insert their own Social Security data
CREATE POLICY "Users insert own SSA data" ON social_security_data
  FOR INSERT
  WITH CHECK (auth.uid() = client_id);

-- RLS Policy: Users can update their own Social Security data
CREATE POLICY "Users update own SSA data" ON social_security_data
  FOR UPDATE
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id);

-- RLS Policy: Advisors can view all Social Security data
CREATE POLICY "Advisors view all SSA data" ON social_security_data
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- RLS Policy: Advisors can manage all Social Security data
CREATE POLICY "Advisors manage all SSA data" ON social_security_data
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- Trigger: Auto-update updated_at timestamp
CREATE TRIGGER update_social_security_updated_at
  BEFORE UPDATE ON social_security_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ================================================
-- Comments for documentation
-- ================================================
COMMENT ON TABLE social_security_data IS 'Stores Social Security benefit estimates and retirement planning data for clients';
COMMENT ON COLUMN social_security_data.present_value_of_benefits IS 'Present value of lifetime Social Security benefits calculated using annuity formula';
COMMENT ON COLUMN social_security_data.estimated_ssa_start_age IS 'Age at which client plans to start claiming Social Security benefits (62-70)';
COMMENT ON COLUMN social_security_data.statement_upload_path IS 'Supabase Storage path to uploaded SSA statement PDF';

-- ================================================
-- Present Value Calculation Notes
-- ================================================
-- Formula: PV = Monthly_Benefit × 12 × ((1 - (1 + r)^-n) / r) × (1 + r)^-years_until_start
-- Where:
--   r = monthly discount rate (annual_rate / 12, typically 0.03 / 12 = 0.0025)
--   n = number of monthly payments (from start_age to life_expectancy in months)
--   years_until_start = max(0, start_age - current_age)
--   life_expectancy = typically 90 years
--
-- This calculation is performed in the application layer (SocialSecurity model)
-- and stored in the present_value_of_benefits field
