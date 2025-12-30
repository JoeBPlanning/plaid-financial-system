-- Optional: Encryption Setup for Plaid Access Tokens using Supabase Vault
-- This requires Supabase Pro plan or self-hosted with pg_vault extension

-- IMPORTANT: If you don't have Supabase Vault, you can:
-- 1. Encrypt tokens in your application layer before storing
-- 2. Use environment-based encryption keys
-- 3. Store tokens as-is (less secure) and rely on RLS + HTTPS

-- ============================================
-- OPTION 1: Using Supabase Vault (Recommended for Production)
-- ============================================

-- Enable the pgsodium extension (Supabase Vault)
-- CREATE EXTENSION IF NOT EXISTS pgsodium;

-- Create a key for encryption (run once)
-- SELECT pgsodium.create_key(name := 'plaid_tokens_key');

-- Modify plaid_connections table to use encrypted column
-- ALTER TABLE plaid_connections
--   ADD COLUMN access_token_encrypted bytea;

-- Create function to encrypt access tokens
-- CREATE OR REPLACE FUNCTION encrypt_access_token()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF NEW.access_token IS NOT NULL THEN
--     NEW.access_token_encrypted = pgsodium.crypto_aead_det_encrypt(
--       NEW.access_token::bytea,
--       (SELECT id FROM pgsodium.valid_key WHERE name = 'plaid_tokens_key')::uuid,
--       (NEW.client_id::text || NEW.item_id)::bytea
--     );
--     NEW.access_token = NULL; -- Clear plaintext
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically encrypt on insert/update
-- CREATE TRIGGER encrypt_plaid_token_trigger
--   BEFORE INSERT OR UPDATE ON plaid_connections
--   FOR EACH ROW
--   EXECUTE FUNCTION encrypt_access_token();

-- Create function to decrypt access tokens (call from your backend)
-- CREATE OR REPLACE FUNCTION decrypt_access_token(
--   client_id_param UUID,
--   item_id_param TEXT
-- )
-- RETURNS TEXT AS $$
-- DECLARE
--   encrypted_token bytea;
--   decrypted_token bytea;
-- BEGIN
--   SELECT access_token_encrypted INTO encrypted_token
--   FROM plaid_connections
--   WHERE client_id = client_id_param AND item_id = item_id_param;
--
--   IF encrypted_token IS NULL THEN
--     RETURN NULL;
--   END IF;
--
--   decrypted_token := pgsodium.crypto_aead_det_decrypt(
--     encrypted_token,
--     (SELECT id FROM pgsodium.valid_key WHERE name = 'plaid_tokens_key')::uuid,
--     (client_id_param::text || item_id_param)::bytea
--   );
--
--   RETURN convert_from(decrypted_token, 'UTF8');
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- OPTION 2: Application-Layer Encryption (Simpler, works on all plans)
-- ============================================

-- Use Node.js crypto module to encrypt/decrypt before saving to DB
-- Example in your backend:
--
-- const crypto = require('crypto');
-- const algorithm = 'aes-256-gcm';
-- const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // 32 bytes
--
-- function encrypt(text) {
--   const iv = crypto.randomBytes(16);
--   const cipher = crypto.createCipheriv(algorithm, key, iv);
--   let encrypted = cipher.update(text, 'utf8', 'hex');
--   encrypted += cipher.final('hex');
--   const authTag = cipher.getAuthTag();
--   return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
-- }
--
-- function decrypt(text) {
--   const parts = text.split(':');
--   const iv = Buffer.from(parts[0], 'hex');
--   const authTag = Buffer.from(parts[1], 'hex');
--   const encrypted = parts[2];
--   const decipher = crypto.createDecipheriv(algorithm, key, iv);
--   decipher.setAuthTag(authTag);
--   let decrypted = decipher.update(encrypted, 'hex', 'utf8');
--   decrypted += decipher.final('utf8');
--   return decrypted;
-- }

-- ============================================
-- RECOMMENDED APPROACH FOR GETTING STARTED
-- ============================================

-- For now, store tokens as TEXT with proper RLS policies
-- Later upgrade to encrypted storage when moving to production

-- Grant necessary permissions for service role
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Note: The above grants are broad. In production, restrict based on your needs
-- Example: GRANT SELECT, INSERT, UPDATE, DELETE ON specific_table TO authenticated;
