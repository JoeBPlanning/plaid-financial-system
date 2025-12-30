-- Row Level Security (RLS) Policies
-- Run this AFTER 001_initial_schema.sql

-- Enable Row Level Security on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE plaid_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE investment_snapshots ENABLE ROW LEVEL SECURITY;

-- ============================================
-- CLIENTS TABLE POLICIES
-- ============================================

-- Policy: Clients can read their own data
CREATE POLICY "Clients can view own data" ON clients
  FOR SELECT
  USING (
    auth.uid()::text = client_id::text
  );

-- Policy: Clients can update their own profile
CREATE POLICY "Clients can update own profile" ON clients
  FOR UPDATE
  USING (
    auth.uid()::text = client_id::text
  )
  WITH CHECK (
    auth.uid()::text = client_id::text
  );

-- Policy: Advisor can view all their clients
CREATE POLICY "Advisor can view all clients" ON clients
  FOR SELECT
  USING (
    -- Replace 'YOUR_ADVISOR_ID' with your actual advisor ID
    -- Or use auth.jwt() ->> 'role' = 'advisor' if you set up custom claims
    advisor_id = auth.jwt() ->> 'advisor_id'
    OR
    auth.jwt() ->> 'role' = 'advisor'
  );

-- Policy: Advisor can insert new clients
CREATE POLICY "Advisor can create clients" ON clients
  FOR INSERT
  WITH CHECK (
    auth.jwt() ->> 'role' = 'advisor'
    OR
    advisor_id = auth.jwt() ->> 'advisor_id'
  );

-- Policy: Advisor can update client data
CREATE POLICY "Advisor can update clients" ON clients
  FOR UPDATE
  USING (
    auth.jwt() ->> 'role' = 'advisor'
    OR
    advisor_id = auth.jwt() ->> 'advisor_id'
  )
  WITH CHECK (
    auth.jwt() ->> 'role' = 'advisor'
    OR
    advisor_id = auth.jwt() ->> 'advisor_id'
  );

-- ============================================
-- PLAID_CONNECTIONS TABLE POLICIES
-- ============================================

-- Policy: Clients can view their own plaid connections
CREATE POLICY "Clients can view own plaid connections" ON plaid_connections
  FOR SELECT
  USING (
    auth.uid()::text = client_id::text
  );

-- Policy: Clients can insert their own plaid connections
CREATE POLICY "Clients can create own plaid connections" ON plaid_connections
  FOR INSERT
  WITH CHECK (
    auth.uid()::text = client_id::text
  );

-- Policy: Clients can update their own plaid connections
CREATE POLICY "Clients can update own plaid connections" ON plaid_connections
  FOR UPDATE
  USING (
    auth.uid()::text = client_id::text
  )
  WITH CHECK (
    auth.uid()::text = client_id::text
  );

-- Policy: Advisor can view all client plaid connections
CREATE POLICY "Advisor can view all plaid connections" ON plaid_connections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = plaid_connections.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- Policy: Advisor can manage all client plaid connections
CREATE POLICY "Advisor can manage plaid connections" ON plaid_connections
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = plaid_connections.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = plaid_connections.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- ============================================
-- TRANSACTIONS TABLE POLICIES
-- ============================================

-- Policy: Clients can view their own transactions
CREATE POLICY "Clients can view own transactions" ON transactions
  FOR SELECT
  USING (
    auth.uid()::text = client_id::text
  );

-- Policy: Clients can update their own transactions (categories, notes)
CREATE POLICY "Clients can update own transactions" ON transactions
  FOR UPDATE
  USING (
    auth.uid()::text = client_id::text
  )
  WITH CHECK (
    auth.uid()::text = client_id::text
  );

-- Policy: Advisor can view all client transactions
CREATE POLICY "Advisor can view all transactions" ON transactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = transactions.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- Policy: Advisor can manage all client transactions
CREATE POLICY "Advisor can manage transactions" ON transactions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = transactions.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = transactions.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- ============================================
-- MONTHLY_SUMMARIES TABLE POLICIES
-- ============================================

-- Policy: Clients can view their own monthly summaries
CREATE POLICY "Clients can view own monthly summaries" ON monthly_summaries
  FOR SELECT
  USING (
    auth.uid()::text = client_id::text
  );

-- Policy: Advisor can view all client monthly summaries
CREATE POLICY "Advisor can view all monthly summaries" ON monthly_summaries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = monthly_summaries.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- Policy: Advisor can manage all client monthly summaries
CREATE POLICY "Advisor can manage monthly summaries" ON monthly_summaries
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = monthly_summaries.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = monthly_summaries.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- ============================================
-- DOCUMENTS TABLE POLICIES
-- ============================================

-- Policy: Clients can view their own documents
CREATE POLICY "Clients can view own documents" ON documents
  FOR SELECT
  USING (
    auth.uid()::text = client_id::text
  );

-- Policy: Advisor can view all client documents
CREATE POLICY "Advisor can view all documents" ON documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = documents.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- Policy: Advisor can manage all client documents
CREATE POLICY "Advisor can manage documents" ON documents
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = documents.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = documents.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- ============================================
-- INVESTMENTS TABLE POLICIES
-- ============================================

-- Policy: Clients can view their own investments
CREATE POLICY "Clients can view own investments" ON investments
  FOR SELECT
  USING (
    auth.uid()::text = client_id::text
  );

-- Policy: Advisor can view all client investments
CREATE POLICY "Advisor can view all investments" ON investments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = investments.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- Policy: Advisor can manage all client investments
CREATE POLICY "Advisor can manage investments" ON investments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = investments.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = investments.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- ============================================
-- BALANCE_SHEETS TABLE POLICIES
-- ============================================

-- Policy: Clients can view their own balance sheets
CREATE POLICY "Clients can view own balance sheets" ON balance_sheets
  FOR SELECT
  USING (
    auth.uid()::text = client_id::text
  );

-- Policy: Advisor can view all client balance sheets
CREATE POLICY "Advisor can view all balance sheets" ON balance_sheets
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = balance_sheets.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- Policy: Advisor can manage all client balance sheets
CREATE POLICY "Advisor can manage balance sheets" ON balance_sheets
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = balance_sheets.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = balance_sheets.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- ============================================
-- INVESTMENT_SNAPSHOTS TABLE POLICIES
-- ============================================

-- Policy: Clients can view their own investment snapshots
CREATE POLICY "Clients can view own investment snapshots" ON investment_snapshots
  FOR SELECT
  USING (
    auth.uid()::text = client_id::text
  );

-- Policy: Advisor can view all client investment snapshots
CREATE POLICY "Advisor can view all investment snapshots" ON investment_snapshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = investment_snapshots.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- Policy: Advisor can manage all client investment snapshots
CREATE POLICY "Advisor can manage investment snapshots" ON investment_snapshots
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = investment_snapshots.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.client_id = investment_snapshots.client_id
      AND (c.advisor_id = auth.jwt() ->> 'advisor_id' OR auth.jwt() ->> 'role' = 'advisor')
    )
  );

-- ============================================
-- STORAGE POLICIES (for document files)
-- ============================================

-- Create a storage bucket for documents (run this in Supabase dashboard or via API)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('client-documents', 'client-documents', false);

-- Policy: Clients can view their own documents in storage
-- CREATE POLICY "Clients can view own files" ON storage.objects
--   FOR SELECT
--   USING (
--     bucket_id = 'client-documents'
--     AND auth.uid()::text = (storage.foldername(name))[1]
--   );

-- Policy: Advisor can view all client documents in storage
-- CREATE POLICY "Advisor can view all files" ON storage.objects
--   FOR SELECT
--   USING (
--     bucket_id = 'client-documents'
--     AND auth.jwt() ->> 'role' = 'advisor'
--   );

-- Policy: Advisor can upload client documents
-- CREATE POLICY "Advisor can upload files" ON storage.objects
--   FOR INSERT
--   WITH CHECK (
--     bucket_id = 'client-documents'
--     AND auth.jwt() ->> 'role' = 'advisor'
--   );

-- Policy: Advisor can delete client documents
-- CREATE POLICY "Advisor can delete files" ON storage.objects
--   FOR DELETE
--   USING (
--     bucket_id = 'client-documents'
--     AND auth.jwt() ->> 'role' = 'advisor'
--   );
