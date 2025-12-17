const jwt = require('jsonwebtoken');
const Client = require('../models-sqlite/Client');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Middleware to verify JWT token and attach clientId to req.user
 * Reads JWT from HttpOnly cookie named 'session'
 * Returns 401 if missing or invalid
 */
function requireAuth(req, res, next) {
  try {
    // Read token from HttpOnly cookie
    const token = req.cookies?.session;

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }

    // Verify JWT signature
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verify payload contains clientId
    if (!decoded.clientId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token payload' 
      });
    }

    // Attach clientId to req.user
    req.user = { clientId: decoded.clientId };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expired' 
      });
    }
    
    console.error('Auth middleware error:', error);
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication failed' 
    });
  }
}

/**
 * Legacy middleware - kept for backward compatibility
 * @deprecated Use requireAuth instead
 */
async function authenticateToken(req, res, next) {
  try {
    // Read token from HttpOnly cookie
    const token = req.cookies?.session;

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Access token required' 
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verify client still exists and is active
    const client = await Client.findOne({ clientId: decoded.clientId });
    
    if (!client || !client.isActive) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid or inactive client' 
      });
    }

    // Attach client to request
    req.client = client;
    req.clientId = decoded.clientId;
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ 
        success: false, 
        error: 'Invalid token' 
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ 
        success: false, 
        error: 'Token expired' 
      });
    }
    
    console.error('Auth middleware error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Authentication error' 
    });
  }
}

/**
 * Generate JWT token for a client
 */
function generateToken(clientId) {
  return jwt.sign(
    { clientId },
    JWT_SECRET,
    { expiresIn: '7d' } // Token expires in 7 days
  );
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
 * Middleware to require admin role
 * Requires requireAuth to be called first (req.user.clientId must exist)
 * Fetches client from database to check role
 * Returns 403 if user is not an admin
 */
async function requireAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.clientId) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required' 
      });
    }

    // Fetch client to check role
    const client = await Client.findOne({ clientId: req.user.clientId });
    
    if (!client) {
      return res.status(401).json({ 
        success: false, 
        error: 'Client not found' 
      });
    }

    // Check if user has admin role
    // Default to 'user' if role is not set
    const userRole = client.role || 'user';
    
    if (userRole !== 'admin') {
      // Log security event: unauthorized admin access attempt
      const { logSecurityEvent } = require('./auditLogger');
      logSecurityEvent('unauthorized_admin_access_attempt', req.user.clientId, req.ip, {
        route: req.path,
        method: req.method,
        userRole
      });
      
      return res.status(403).json({ 
        success: false, 
        error: 'Admin access required' 
      });
    }

    // Attach role to req.user for use in route handlers
    req.user.role = userRole;
    
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
  authenticateToken, // Legacy - kept for backward compatibility
  generateToken,
  ensureClientOwnership,
  requireAdmin,
  JWT_SECRET
};

