-- Supabase Auth Configuration
-- Run this AFTER setting up Supabase Auth in the dashboard

-- ============================================
-- LINK SUPABASE AUTH TO CLIENTS TABLE
-- ============================================

-- This trigger automatically creates a client record when a user signs up via Supabase Auth
-- The client_id will match the auth.users.id (UUID)

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert a new client record with data from auth.users
  INSERT INTO public.clients (
    client_id,
    name,
    email,
    is_active,
    advisor_id,
    preferences,
    client_profile,
    created_at
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    true,
    COALESCE(NEW.raw_user_meta_data->>'advisor_id', 'advisor_main'),
    '{}',
    '{}',
    NOW()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to run after user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- UPDATE RLS POLICIES TO USE auth.uid()
-- ============================================

-- Drop existing RLS policies (from 002_row_level_security.sql)
-- We'll recreate them to use auth.uid() instead of custom JWT claims

-- CLIENTS TABLE
DROP POLICY IF EXISTS "Clients can view own data" ON clients;
DROP POLICY IF EXISTS "Clients can update own profile" ON clients;
DROP POLICY IF EXISTS "Advisor can view all clients" ON clients;
DROP POLICY IF EXISTS "Advisor can create clients" ON clients;
DROP POLICY IF EXISTS "Advisor can update clients" ON clients;

-- Create new policies using auth.uid()
CREATE POLICY "Users can view own client data" ON clients
  FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Users can update own profile" ON clients
  FOR UPDATE
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Advisors can view all clients" ON clients
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can create clients" ON clients
  FOR INSERT
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can update clients" ON clients
  FOR UPDATE
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- PLAID_CONNECTIONS TABLE
DROP POLICY IF EXISTS "Clients can view own plaid connections" ON plaid_connections;
DROP POLICY IF EXISTS "Clients can create own plaid connections" ON plaid_connections;
DROP POLICY IF EXISTS "Clients can update own plaid connections" ON plaid_connections;
DROP POLICY IF EXISTS "Advisor can view all plaid connections" ON plaid_connections;
DROP POLICY IF EXISTS "Advisor can manage plaid connections" ON plaid_connections;

CREATE POLICY "Users can view own connections" ON plaid_connections
  FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Users can create own connections" ON plaid_connections
  FOR INSERT
  WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Users can update own connections" ON plaid_connections
  FOR UPDATE
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Advisors can view all connections" ON plaid_connections
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can manage connections" ON plaid_connections
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- TRANSACTIONS TABLE
DROP POLICY IF EXISTS "Clients can view own transactions" ON transactions;
DROP POLICY IF EXISTS "Clients can update own transactions" ON transactions;
DROP POLICY IF EXISTS "Advisor can view all transactions" ON transactions;
DROP POLICY IF EXISTS "Advisor can manage transactions" ON transactions;

CREATE POLICY "Users can view own transactions" ON transactions
  FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Users can update own transactions" ON transactions
  FOR UPDATE
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Advisors can view all transactions" ON transactions
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can manage transactions" ON transactions
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- MONTHLY_SUMMARIES TABLE
DROP POLICY IF EXISTS "Clients can view own monthly summaries" ON monthly_summaries;
DROP POLICY IF EXISTS "Advisor can view all monthly summaries" ON monthly_summaries;
DROP POLICY IF EXISTS "Advisor can manage monthly summaries" ON monthly_summaries;

CREATE POLICY "Users can view own summaries" ON monthly_summaries
  FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Advisors can view all summaries" ON monthly_summaries
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can manage summaries" ON monthly_summaries
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- DOCUMENTS TABLE
DROP POLICY IF EXISTS "Clients can view own documents" ON documents;
DROP POLICY IF EXISTS "Advisor can view all documents" ON documents;
DROP POLICY IF EXISTS "Advisor can manage documents" ON documents;

CREATE POLICY "Users can view own documents" ON documents
  FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Advisors can view all documents" ON documents
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can manage documents" ON documents
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- INVESTMENTS TABLE
DROP POLICY IF EXISTS "Clients can view own investments" ON investments;
DROP POLICY IF EXISTS "Advisor can view all investments" ON investments;
DROP POLICY IF EXISTS "Advisor can manage investments" ON investments;

CREATE POLICY "Users can view own investments" ON investments
  FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Advisors can view all investments" ON investments
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can manage investments" ON investments
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- BALANCE_SHEETS TABLE
DROP POLICY IF EXISTS "Clients can view own balance sheets" ON balance_sheets;
DROP POLICY IF EXISTS "Advisor can view all balance sheets" ON balance_sheets;
DROP POLICY IF EXISTS "Advisor can manage balance sheets" ON balance_sheets;

CREATE POLICY "Users can view own balance sheets" ON balance_sheets
  FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Advisors can view all balance sheets" ON balance_sheets
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can manage balance sheets" ON balance_sheets
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- INVESTMENT_SNAPSHOTS TABLE
DROP POLICY IF EXISTS "Clients can view own investment snapshots" ON investment_snapshots;
DROP POLICY IF EXISTS "Advisor can view all investment snapshots" ON investment_snapshots;
DROP POLICY IF EXISTS "Advisor can manage investment snapshots" ON investment_snapshots;

CREATE POLICY "Users can view own snapshots" ON investment_snapshots
  FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Advisors can view all snapshots" ON investment_snapshots
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

CREATE POLICY "Advisors can manage snapshots" ON investment_snapshots
  FOR ALL
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
  );

-- ============================================
-- EMAIL VERIFICATION (OPTIONAL)
-- ============================================

-- Function to check if email is verified
-- Can be used in RLS policies if you want to require verified emails
CREATE OR REPLACE FUNCTION is_email_verified()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN (
    SELECT email_confirmed_at IS NOT NULL
    FROM auth.users
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Example: Require email verification for sensitive operations
-- Uncomment and modify as needed:

-- CREATE POLICY "Verified users only" ON plaid_connections
--   FOR INSERT
--   WITH CHECK (
--     auth.uid() = client_id
--     AND is_email_verified()
--   );

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role',
    'user'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if current user is advisor
CREATE OR REPLACE FUNCTION is_advisor()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN get_user_role() = 'advisor';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- SECURITY NOTES
-- ============================================

-- 1. Supabase Auth users are in the auth.users table
-- 2. Application client data is in the public.clients table
-- 3. client_id in clients table = id in auth.users table (both UUIDs)
-- 4. auth.uid() returns the current user's UUID
-- 5. User metadata (role, advisor_id) is stored in auth.users.raw_user_meta_data
-- 6. RLS policies automatically filter queries based on auth.uid()
-- 7. Service role key bypasses RLS (use carefully in backend!)

-- ============================================
-- TESTING QUERIES
-- ============================================

-- Test if trigger works (run after first user signs up):
-- SELECT * FROM auth.users;
-- SELECT * FROM clients;

-- Test RLS policies (as a user):
-- SELECT * FROM clients; -- Should only see own record
-- SELECT * FROM transactions; -- Should only see own transactions

-- Test RLS policies (as advisor, set role in user_metadata):
-- SELECT * FROM clients; -- Should see all clients
-- SELECT * FROM transactions; -- Should see all transactions
