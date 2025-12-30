-- Supabase Migration Script
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  is_active BOOLEAN DEFAULT true,
  advisor_id TEXT NOT NULL,
  preferences JSONB DEFAULT '{}'::jsonb,
  client_profile JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create plaid_connections table (renamed from plaid_access_tokens for clarity)
CREATE TABLE IF NOT EXISTS plaid_connections (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  access_token TEXT NOT NULL, -- Will be encrypted via Supabase Vault
  item_id TEXT NOT NULL,
  institution_name TEXT,
  institution_id TEXT,
  account_ids JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  transaction_cursor TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  plaid_transaction_id TEXT UNIQUE NOT NULL,
  account_id TEXT NOT NULL,
  account_type TEXT,
  account_subtype TEXT,
  account_name TEXT,
  account_mask TEXT,
  amount DECIMAL(12, 2) NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL,
  merchant_name TEXT,
  category JSONB DEFAULT '[]'::jsonb,
  plaid_category TEXT,
  plaid_sub_category TEXT,
  personal_finance_category JSONB,
  suggested_category TEXT NOT NULL,
  user_category TEXT,
  is_reviewed BOOLEAN DEFAULT false,
  month_year TEXT NOT NULL, -- Format: YYYY-MM
  notes TEXT,
  institution TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create monthly_summaries table
CREATE TABLE IF NOT EXISTS monthly_summaries (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  month_year TEXT NOT NULL, -- Format: YYYY-MM
  date TIMESTAMPTZ NOT NULL,
  year INTEGER NOT NULL,
  cash_flow JSONB NOT NULL DEFAULT '{}'::jsonb,
  net_worth JSONB NOT NULL DEFAULT '{}'::jsonb,
  client_profile JSONB DEFAULT '{}'::jsonb,
  transactions_processed INTEGER DEFAULT 0,
  last_processed_at TIMESTAMPTZ,
  review_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, month_year)
);

-- Create documents table (for PDF reports)
CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  document_type TEXT NOT NULL, -- e.g., 'monthly_report', 'annual_summary', 'tax_document'
  title TEXT NOT NULL,
  description TEXT,
  file_path TEXT, -- Path in Supabase Storage
  file_url TEXT, -- Public/signed URL
  month_year TEXT, -- Format: YYYY-MM (if applicable)
  year INTEGER, -- Year (if applicable)
  metadata JSONB DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create investments table (from your existing schema)
CREATE TABLE IF NOT EXISTS investments (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  account_name TEXT,
  account_type TEXT,
  account_subtype TEXT,
  security_id TEXT NOT NULL,
  security_name TEXT,
  security_ticker TEXT,
  security_type TEXT,
  quantity DECIMAL(18, 6) DEFAULT 0,
  price DECIMAL(12, 2) DEFAULT 0,
  value DECIMAL(12, 2) DEFAULT 0,
  cost_basis DECIMAL(12, 2) DEFAULT 0,
  institution_name TEXT,
  institution_id TEXT,
  item_id TEXT,
  account_tax_type TEXT, -- 'tax-free', 'tax-deferred', 'taxable'
  last_updated TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, account_id, security_id)
);

-- Create balance_sheets table (from your existing schema)
CREATE TABLE IF NOT EXISTS balance_sheets (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  month_year TEXT, -- Format: YYYY-MM
  assets DECIMAL(12, 2) DEFAULT 0,
  liabilities DECIMAL(12, 2) DEFAULT 0,
  net_worth DECIMAL(12, 2) DEFAULT 0,
  asset_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  liability_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, snapshot_date)
);

-- Create investment_snapshots table (from your existing schema)
CREATE TABLE IF NOT EXISTS investment_snapshots (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  month_year TEXT, -- Format: YYYY-MM
  total_value DECIMAL(12, 2) DEFAULT 0,
  total_by_tax_type JSONB NOT NULL DEFAULT '{}'::jsonb,
  holdings_by_account JSONB NOT NULL DEFAULT '{}'::jsonb,
  asset_class_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, snapshot_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_clients_client_id ON clients(client_id);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_username ON clients(username);
CREATE INDEX IF NOT EXISTS idx_clients_advisor_id ON clients(advisor_id);

CREATE INDEX IF NOT EXISTS idx_plaid_connections_client_id ON plaid_connections(client_id);
CREATE INDEX IF NOT EXISTS idx_plaid_connections_item_id ON plaid_connections(item_id);

CREATE INDEX IF NOT EXISTS idx_transactions_client_id ON transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_transactions_month_year ON transactions(month_year);
CREATE INDEX IF NOT EXISTS idx_transactions_plaid_id ON transactions(plaid_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_client_month ON transactions(client_id, month_year);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);

CREATE INDEX IF NOT EXISTS idx_monthly_summaries_client_id ON monthly_summaries(client_id);
CREATE INDEX IF NOT EXISTS idx_monthly_summaries_month_year ON monthly_summaries(month_year);
CREATE INDEX IF NOT EXISTS idx_monthly_summaries_client_month ON monthly_summaries(client_id, month_year);

CREATE INDEX IF NOT EXISTS idx_documents_client_id ON documents(client_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
CREATE INDEX IF NOT EXISTS idx_documents_month_year ON documents(month_year);

CREATE INDEX IF NOT EXISTS idx_investments_client_id ON investments(client_id);
CREATE INDEX IF NOT EXISTS idx_investments_account_id ON investments(account_id);
CREATE INDEX IF NOT EXISTS idx_investments_security_id ON investments(security_id);

CREATE INDEX IF NOT EXISTS idx_balance_sheets_client_id ON balance_sheets(client_id);
CREATE INDEX IF NOT EXISTS idx_balance_sheets_snapshot_date ON balance_sheets(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_balance_sheets_month_year ON balance_sheets(month_year);
CREATE INDEX IF NOT EXISTS idx_balance_sheets_client_date ON balance_sheets(client_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_investment_snapshots_client_id ON investment_snapshots(client_id);
CREATE INDEX IF NOT EXISTS idx_investment_snapshots_snapshot_date ON investment_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_investment_snapshots_month_year ON investment_snapshots(month_year);
CREATE INDEX IF NOT EXISTS idx_investment_snapshots_client_date ON investment_snapshots(client_id, snapshot_date);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plaid_connections_updated_at BEFORE UPDATE ON plaid_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_monthly_summaries_updated_at BEFORE UPDATE ON monthly_summaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_investments_updated_at BEFORE UPDATE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_balance_sheets_updated_at BEFORE UPDATE ON balance_sheets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_investment_snapshots_updated_at BEFORE UPDATE ON investment_snapshots
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
