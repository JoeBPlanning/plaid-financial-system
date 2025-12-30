const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Supabase configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role key for backend

let supabase;

function initDatabase() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase credentials. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env file');
  }

  // Create Supabase client with service role key (bypasses RLS for admin operations)
  supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  });

  console.log('✅ Supabase database client initialized');
  return supabase;
}

function getDatabase() {
  if (!supabase) {
    return initDatabase();
  }
  return supabase;
}

// Helper function to create a client-specific Supabase instance (respects RLS)
function getClientDatabase(accessToken) {
  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL in .env file');
  }

  return createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

// Close connection (not needed for Supabase HTTP client, but kept for compatibility)
function closeDatabase() {
  // Supabase client doesn't need explicit closing
  supabase = null;
}

module.exports = {
  initDatabase,
  getDatabase,
  getClientDatabase,
  closeDatabase
};
