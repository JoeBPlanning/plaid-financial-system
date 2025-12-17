const rateLimit = require('express-rate-limit');

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for login endpoint
// 5 attempts per 15 minutes to prevent brute force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: {
    success: false,
    error: 'Too many login attempts from this IP, please try again after 15 minutes.'
  },
  skipSuccessfulRequests: true, // Don't count successful requests
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

// Rate limiter for registration endpoint
// 10 attempts per 15 minutes (more lenient for legitimate account creation)
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 registration attempts per windowMs
  message: {
    success: false,
    error: 'Too many registration attempts from this IP, please try again after 15 minutes.'
  },
  skipSuccessfulRequests: true, // Don't count successful registrations
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for forgot-password endpoint
// 5 attempts per 15 minutes to prevent abuse and email enumeration
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 password reset requests per windowMs
  message: {
    success: false,
    error: 'Too many password reset requests from this IP, please try again after 15 minutes.'
  },
  skipSuccessfulRequests: false, // Count all requests (including successful ones) to prevent enumeration
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for Plaid-related endpoints
// 20 requests per 15 minutes to prevent abuse while allowing legitimate use
const plaidLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 Plaid requests per windowMs
  message: {
    success: false,
    error: 'Too many Plaid requests from this IP, please try again after 15 minutes.'
  },
  skipSuccessfulRequests: false, // Count all requests
  standardHeaders: true,
  legacyHeaders: false,
});

// Legacy: kept for backward compatibility
// @deprecated Use loginLimiter instead
const authLimiter = loginLimiter;

module.exports = {
  apiLimiter,
  loginLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  plaidLimiter,
  authLimiter, // Legacy export
};

