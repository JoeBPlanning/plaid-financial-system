-- Invite Codes System for Invite-Only Registration
-- This migration creates the invite_codes table and RLS policies

-- ============================================
-- CREATE INVITE_CODES TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS invite_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  client_name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  is_used BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),

  -- Constraints
  CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'),
  CONSTRAINT code_format CHECK (code ~* '^[A-Z0-9]{4}-[A-Z0-9]{4}$')
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_invite_codes_code ON invite_codes(code);
CREATE INDEX IF NOT EXISTS idx_invite_codes_email ON invite_codes(email);
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_invite_codes_is_used ON invite_codes(is_used);
CREATE INDEX IF NOT EXISTS idx_invite_codes_expires_at ON invite_codes(expires_at);

-- ============================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================

ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

-- ============================================
-- RLS POLICIES
-- ============================================

-- Policy: Only advisors can create invite codes
CREATE POLICY "Advisors can create invite codes" ON invite_codes
  FOR INSERT
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
    AND created_by = auth.uid()
  );

-- Policy: Only advisors can view invite codes they created
CREATE POLICY "Advisors can view own invite codes" ON invite_codes
  FOR SELECT
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
    AND created_by = auth.uid()
  );

-- Policy: Only advisors can update invite codes they created
CREATE POLICY "Advisors can update own invite codes" ON invite_codes
  FOR UPDATE
  USING (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
    AND created_by = auth.uid()
  )
  WITH CHECK (
    (auth.jwt() ->> 'user_metadata')::jsonb ->> 'role' = 'advisor'
    AND created_by = auth.uid()
  );

-- Policy: Public can verify invite codes (for registration)
-- This is needed so unauthenticated users can validate codes during registration
-- Note: We'll use service role in backend to mark codes as used for security
CREATE POLICY "Public can verify invite codes" ON invite_codes
  FOR SELECT
  USING (true); -- Allow anyone to check if a code exists

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to generate random invite code
CREATE OR REPLACE FUNCTION generate_invite_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Excludes ambiguous chars
  result TEXT := '';
  i INTEGER;
BEGIN
  -- Generate 4 random characters
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;

  result := result || '-';

  -- Generate 4 more random characters
  FOR i IN 1..4 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to check if invite code is valid
CREATE OR REPLACE FUNCTION is_invite_code_valid(invite_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  code_record RECORD;
BEGIN
  SELECT * INTO code_record
  FROM invite_codes
  WHERE code = UPPER(invite_code)
  AND is_used = false
  AND expires_at > NOW();

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get invite code details (for registration)
CREATE OR REPLACE FUNCTION get_invite_code_details(invite_code TEXT)
RETURNS TABLE(
  email TEXT,
  client_name TEXT,
  is_valid BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  code_record RECORD;
BEGIN
  SELECT * INTO code_record
  FROM invite_codes
  WHERE code = UPPER(invite_code);

  -- Code doesn't exist
  IF NOT FOUND THEN
    RETURN QUERY SELECT
      NULL::TEXT,
      NULL::TEXT,
      false,
      'Invalid invite code'::TEXT;
    RETURN;
  END IF;

  -- Code already used
  IF code_record.is_used THEN
    RETURN QUERY SELECT
      NULL::TEXT,
      NULL::TEXT,
      false,
      'This invite code has already been used'::TEXT;
    RETURN;
  END IF;

  -- Code expired
  IF code_record.expires_at < NOW() THEN
    RETURN QUERY SELECT
      NULL::TEXT,
      NULL::TEXT,
      false,
      'This invite code has expired'::TEXT;
    RETURN;
  END IF;

  -- Code is valid
  RETURN QUERY SELECT
    code_record.email,
    code_record.client_name,
    true,
    NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark invite code as used
CREATE OR REPLACE FUNCTION mark_invite_code_used(invite_code TEXT, user_email TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  code_record RECORD;
BEGIN
  -- Get the invite code
  SELECT * INTO code_record
  FROM invite_codes
  WHERE code = UPPER(invite_code)
  AND is_used = false
  AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Verify email matches
  IF LOWER(code_record.email) != LOWER(user_email) THEN
    RAISE EXCEPTION 'Email does not match invite code';
  END IF;

  -- Mark as used
  UPDATE invite_codes
  SET is_used = true,
      used_at = NOW()
  WHERE code = UPPER(invite_code);

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- AUTOMATIC CLEANUP (Optional)
-- ============================================

-- Function to clean up expired invite codes (run via cron job)
CREATE OR REPLACE FUNCTION cleanup_expired_invites()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM invite_codes
  WHERE is_used = false
  AND expires_at < NOW() - INTERVAL '90 days'; -- Keep for 90 days after expiry for audit

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Trigger to ensure invite code is uppercase
CREATE OR REPLACE FUNCTION uppercase_invite_code()
RETURNS TRIGGER AS $$
BEGIN
  NEW.code := UPPER(NEW.code);
  NEW.email := LOWER(NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ensure_uppercase_code
  BEFORE INSERT OR UPDATE ON invite_codes
  FOR EACH ROW
  EXECUTE FUNCTION uppercase_invite_code();

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON invite_codes TO postgres, authenticated, service_role;
GRANT SELECT ON invite_codes TO anon; -- For public code verification

-- ============================================
-- TESTING QUERIES
-- ============================================

-- Test generating an invite code:
-- SELECT generate_invite_code();

-- Test creating an invite (as advisor):
-- INSERT INTO invite_codes (code, email, client_name, created_by)
-- VALUES (generate_invite_code(), 'client@example.com', 'John Doe', auth.uid());

-- Test verifying an invite code:
-- SELECT * FROM get_invite_code_details('XXXX-YYYY');

-- Test marking code as used:
-- SELECT mark_invite_code_used('XXXX-YYYY', 'client@example.com');

-- View all invite codes (as advisor):
-- SELECT * FROM invite_codes ORDER BY created_at DESC;

-- Clean up expired invites:
-- SELECT cleanup_expired_invites();
