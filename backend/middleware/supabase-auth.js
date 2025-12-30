/**
 * Supabase Authentication Middleware
 * Replaces JWT cookie-based auth with Supabase Auth
 *
 * IMPORTANT: This middleware verifies Supabase JWTs from the Authorization header
 * and ensures users can only access their own data via RLS policies
 */

const { getDatabase } = require('../database-supabase');

/**
 * Middleware to verify Supabase JWT token
 * Extracts user from Authorization header
 * Sets req.user with Supabase user data
 */
async function requireSupabaseAuth(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authorization header required',
        code: 'NO_AUTH_HEADER'
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token required',
        code: 'NO_TOKEN'
      });
    }

    // Verify token with Supabase
    const supabase = getDatabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('Supabase auth error:', error?.message);
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        code: 'INVALID_TOKEN'
      });
    }

    // Attach user to request
    req.user = {
      id: user.id, // Supabase user UUID
      email: user.email,
      clientId: user.id, // Use Supabase UUID as clientId for backward compatibility
      role: user.user_metadata?.role || 'user',
      advisorId: user.user_metadata?.advisor_id || null,
      metadata: user.user_metadata
    };

    // For debugging in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`✅ Authenticated user: ${user.email} (${user.id})`);
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
}

/**
 * Middleware to ensure client can only access their own data
 * Requires requireSupabaseAuth to be called first
 *
 * NOTE: With Supabase RLS, this is partially redundant since the database
 * enforces access control. However, it's still useful for:
 * 1. Early validation before database queries
 * 2. Clear error messages
 * 3. Audit logging
 */
function ensureClientOwnership(req, res, next) {
  const requestedClientId = req.params.clientId;

  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  // Allow if requesting own data
  if (requestedClientId === req.user.id || requestedClientId === req.user.clientId) {
    return next();
  }

  // Allow if user is an advisor
  if (req.user.role === 'advisor') {
    return next();
  }

  // Log security event
  const { logSecurityEvent } = require('./auditLogger');
  logSecurityEvent('unauthorized_access_attempt', req.user.id, req.ip, {
    requestedClientId,
    route: req.path,
    method: req.method
  });

  return res.status(403).json({
    success: false,
    error: 'Access denied: You can only access your own data'
  });
}

/**
 * Middleware to require advisor role
 * Checks user_metadata.role from Supabase Auth
 */
function requireAdvisor(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  if (req.user.role !== 'advisor') {
    // Log security event
    const { logSecurityEvent } = require('./auditLogger');
    logSecurityEvent('unauthorized_advisor_access_attempt', req.user.id, req.ip, {
      route: req.path,
      method: req.method,
      userRole: req.user.role
    });

    return res.status(403).json({
      success: false,
      error: 'Advisor access required'
    });
  }

  next();
}

/**
 * Optional middleware: Get authenticated user with service role
 * Bypasses RLS to fetch user data (use carefully!)
 */
async function getAuthenticatedClient(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const supabase = getDatabase();

    // Fetch client data from database
    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('client_id', req.user.id)
      .single();

    if (error) {
      console.error('Error fetching client:', error);
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // Attach client data to request
    req.client = client;

    next();
  } catch (error) {
    console.error('Error in getAuthenticatedClient:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch client data'
    });
  }
}

/**
 * Create a Supabase client with user's JWT
 * This client respects RLS policies
 *
 * @param {string} userToken - User's JWT token
 * @returns {SupabaseClient} Supabase client configured for the user
 */
function createUserSupabaseClient(userToken) {
  const { createClient } = require('@supabase/supabase-js');

  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      global: {
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      }
    }
  );
}

module.exports = {
  requireSupabaseAuth,
  ensureClientOwnership,
  requireAdvisor,
  getAuthenticatedClient,
  createUserSupabaseClient
};
