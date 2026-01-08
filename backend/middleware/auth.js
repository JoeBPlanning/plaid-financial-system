const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client with service role key for backend
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('⚠️  Missing Supabase environment variables!');
  console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

/**
 * Middleware to verify Supabase JWT token and attach user info to req.user
 * Reads JWT from Authorization header: "Bearer <token>"
 * Returns 401 if missing or invalid
 */
async function requireAuth(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('Auth verification error:', error?.message);
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }

    // Attach user info to req.user
    // Use Supabase user ID as clientId for consistency
    req.user = {
      clientId: user.id,
      email: user.email,
      name: user.user_metadata?.name || user.email,
      role: user.user_metadata?.role || 'user'
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
}


/**
 * Middleware to ensure client can only access their own data
 * Requires requireAuth to be called first (req.user.clientId must exist)
 */
function ensureClientOwnership(req, res, next) {
  const requestedClientId = req.params.clientId;
  
  if (!req.user || !req.user.clientId) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required' 
    });
  }
  
  if (requestedClientId !== req.user.clientId) {
    // Log security event: unauthorized access attempt
    const { logSecurityEvent } = require('./auditLogger');
    logSecurityEvent('unauthorized_access_attempt', req.user.clientId, req.ip, {
      requestedClientId,
      route: req.path,
      method: req.method
    });
    
    return res.status(403).json({ 
      success: false, 
      error: 'Access denied: You can only access your own data' 
    });
  }
  
  next();
}

/**
 * Middleware to require admin or advisor role
 * Requires requireAuth to be called first (req.user must exist with role)
 * Returns 403 if user is not an admin or advisor
 */
async function requireAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.clientId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    // Check if user has admin or advisor role
    const userRole = req.user.role || 'user';

    if (userRole !== 'admin' && userRole !== 'advisor') {
      // Log security event: unauthorized admin access attempt
      const { logSecurityEvent } = require('./auditLogger');
      logSecurityEvent('unauthorized_admin_access_attempt', req.user.clientId, req.ip, {
        route: req.path,
        method: req.method,
        userRole
      });

      return res.status(403).json({
        success: false,
        error: 'Admin or advisor access required'
      });
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authorization check failed'
    });
  }
}

module.exports = {
  requireAuth,
  ensureClientOwnership,
  requireAdmin,
  supabase
};

