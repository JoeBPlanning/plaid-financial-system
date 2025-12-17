/**
 * Minimal audit logging for security events
 * Logs authentication and admin actions for security monitoring
 */

/**
 * Log authentication events
 */
function logAuthEvent(event, clientId, ip, success, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    clientId: clientId || 'unknown',
    ip: ip || 'unknown',
    success,
    ...details
  };
  
  // Log to console (in production, this should go to a proper logging service)
  console.log(`[AUDIT] ${event}:`, JSON.stringify(logEntry));
}

/**
 * Log admin actions
 */
function logAdminAction(action, adminClientId, targetClientId, ip, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    action,
    adminClientId,
    targetClientId: targetClientId || 'all',
    ip: ip || 'unknown',
    ...details
  };
  
  // Log to console (in production, this should go to a proper logging service)
  console.log(`[AUDIT] Admin Action:`, JSON.stringify(logEntry));
}

/**
 * Log security events (failed auth, unauthorized access, etc.)
 */
function logSecurityEvent(event, clientId, ip, details = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    event,
    clientId: clientId || 'unknown',
    ip: ip || 'unknown',
    severity: 'security',
    ...details
  };
  
  // Log to console (in production, this should go to a proper logging service)
  console.log(`[AUDIT] Security Event:`, JSON.stringify(logEntry));
}

module.exports = {
  logAuthEvent,
  logAdminAction,
  logSecurityEvent
};

