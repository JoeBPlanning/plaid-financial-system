const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const moment = require('moment');
const bcrypt = require('bcrypt');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
require('dotenv').config();

// Initialize SQLite database
const { initDatabase } = require('./database');
initDatabase();

// Import SQLite models
const Client = require('./models-sqlite/Client');
const Transaction = require('./models-sqlite/Transaction');
const MonthlySummary = require('./models-sqlite/MonthlySummary');
const Investment = require('./models-sqlite/Investment');
const BalanceSheet = require('./models-sqlite/BalanceSheet');
const InvestmentSnapshot = require('./models-sqlite/InvestmentSnapshot');

const app = express();

// Import routes
const clientRoutes = require('./routes/clients');

// Import services
const transactionsSync = require('./services/transactionsSync');
const investmentsSync = require('./services/investmentsSync');
const balanceSheetSnapshot = require('./services/balanceSheetSnapshot');
const investmentSnapshot = require('./services/investmentSnapshot');
const { generateToken, requireAuth, ensureClientOwnership, requireAdmin } = require('./middleware/auth');
const { logAuthEvent, logAdminAction, logSecurityEvent } = require('./middleware/auditLogger');

// Security middleware
const helmet = require('helmet');
const { apiLimiter, loginLimiter, registerLimiter, forgotPasswordLimiter, plaidLimiter } = require('./middleware/rateLimiter');

/**
 * Helper function to sanitize error responses
 * Never exposes stack traces or sensitive error details in production
 */
function sanitizeErrorResponse(error, defaultMessage = 'An error occurred') {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    success: false,
    error: defaultMessage,
    // Only include error message in development for debugging
    ...(isProduction ? {} : { message: error?.message })
  };
}

// Middleware
app.use(helmet()); // Security headers
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(cookieParser()); // Parse cookies
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Webhook routes (must be before rate limiting - Plaid calls them directly)
const webhookRoutes = require('./routes/webhooks');
app.use('/api', webhookRoutes);

// Apply rate limiting to all other routes (after webhooks)
app.use(apiLimiter);

// Plaid configuration
const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

// Basic routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Plaid Financial System API is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.PLAID_ENV || 'sandbox',
    database: 'connected (SQLite)'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'Server is healthy',
    uptime: process.uptime(),
    plaid_env: process.env.PLAID_ENV,
    database_status: 'connected (SQLite)'
  });
});

// Client management routes
app.use('/api/clients', clientRoutes);

// =============================================================================
// AUTHENTICATION ROUTES
// =============================================================================

// Login route (with rate limiting)
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username and password are required' 
      });
    }
    
    // Find client by username
    const client = await Client.findOne({ username });
    
    // Always perform password check to prevent timing attacks
    // Use a dummy hash if client doesn't exist to maintain consistent timing
    let passwordValid = false;
    
    if (client) {
      // Check if client is active (but don't reveal this in error message)
      if (!client.isActive) {
        // Use same error message to prevent account status enumeration
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }
      
      // Verify password (check if it's hashed or plain text for migration)
      if (client.password && client.password.startsWith('$2')) {
        // Password is hashed with bcrypt
        passwordValid = await bcrypt.compare(password, client.password);
      } else {
        // Legacy plain text password - migrate to hashed
        passwordValid = client.password === password;
        if (passwordValid) {
          // Hash the password and update it
          const hashedPassword = await bcrypt.hash(password, 10);
          await Client.findOneAndUpdate(
            { clientId: client.clientId },
            { password: hashedPassword }
          );
        }
      }
    } else {
      // Perform dummy bcrypt comparison to prevent timing attacks
      // This ensures similar response time whether user exists or not
      await bcrypt.compare(password, '$2b$10$dummyhashthatwillnevermatch');
    }
    
    // Use same error message regardless of whether username or password was wrong
    // This prevents username enumeration
    if (!client || !passwordValid) {
      // Audit log: failed login attempt
      logAuthEvent('login_failed', username, req.ip, false, { reason: 'invalid_credentials' });
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = generateToken(client.clientId);
    
    // Remove password from response
    const clientResponse = client.toObject();
    delete clientResponse.password;
    
    // Set JWT in HttpOnly cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('session', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Audit log: successful login
    logAuthEvent('login_success', client.clientId, req.ip, true);
    
    // Return response without token
    res.json({ 
      success: true, 
      client: clientResponse,
      message: 'Login successful'
    });
  } catch (error) {
    // Log error for server-side debugging
    console.error('Login error:', error);
    
    // Never expose error details or stack traces in response
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({ 
      success: false, 
      error: 'Login failed. Please try again.' 
    });
  }
});

// Logout route
// Note: Does not require authentication - allows clearing cookie even if token is invalid/expired
app.post('/api/auth/logout', (req, res) => {
  try {
    // Try to get clientId from token if available (for audit logging)
    let clientId = null;
    try {
      const token = req.cookies?.session;
      if (token) {
        const jwt = require('jsonwebtoken');
        const { JWT_SECRET } = require('./middleware/auth');
        const decoded = jwt.verify(token, JWT_SECRET);
        clientId = decoded.clientId;
      }
    } catch (e) {
      // Token invalid/expired - that's okay for logout
    }
    
    // Always clear the session cookie, regardless of authentication status
    // This ensures the cookie is removed even if the token is expired or invalid
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('session', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict'
    });
    
    // Audit log: logout
    if (clientId) {
      logAuthEvent('logout', clientId, req.ip, true);
    }
    
    res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  } catch (error) {
    console.error('Logout error:', error);
    // Even if there's an error, try to clear the cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.clearCookie('session', {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict'
    });
    res.status(500).json(sanitizeErrorResponse(error, 'Logout failed'));
  }
});

// Register route (with rate limiting)
app.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const { username, password, email, name, advisorId } = req.body;
    
    // Input validation
    if (!username || !password || !email || !name) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username, password, email, and name are required' 
      });
    }
    
    // Check if username or email already exists
    const existingUser = await Client.findOne({ 
      $or: [{ username }, { email }] 
    });
    
    if (existingUser) {
      // Use generic message to prevent enumeration
      return res.status(400).json({ 
        success: false, 
        error: 'Registration failed. Please check your information and try again.' 
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Generate unique client ID
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create new client
    const client = await Client.create({
      clientId,
      username,
      password: hashedPassword,
      email,
      name,
      advisorId: advisorId || 'advisor_main',
      isActive: true
    });
    
    // Generate JWT token
    const token = generateToken(client.clientId);
    
    // Remove password from response
    const clientResponse = client.toObject();
    delete clientResponse.password;
    
    // Set JWT in HttpOnly cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('session', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    // Return response without token
    res.json({ 
      success: true, 
      client: clientResponse,
      message: 'Registration successful'
    });
  } catch (error) {
    // Log error for server-side debugging
    console.error('Registration error:', error);
    
    // Never expose error details or stack traces in response
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({ 
      success: false, 
      error: 'Registration failed. Please try again.' 
    });
  }
});

// Forgot password route (with rate limiting)
app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
    // Input validation
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }
    
    // Find client by email
    const client = await Client.findOne({ email });
    
    // Always return success message to prevent email enumeration
    // In production, you would send a password reset email here
    res.json({ 
      success: true, 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    });
    
    // TODO: In production, implement:
    // 1. Generate secure password reset token
    // 2. Store token with expiration in database
    // 3. Send password reset email with link
    // 4. Create /api/auth/reset-password endpoint to handle token validation and password update
    
  } catch (error) {
    // Log error for server-side debugging
    console.error('Forgot password error:', error);
    
    // Always return success message to prevent email enumeration
    // Never expose error details or stack traces in response
    res.json({ 
      success: true, 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    });
  }
});

// Create test user (for development only - disabled in production)
app.post('/api/auth/create-test-user', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  try {
    // Check if user already exists
    const existing = await Client.findOne({ clientId: 'client_test_user' });
    if (existing) {
      return res.json({ message: 'Test user already exists' });
    }

    const testClient = await Client.create({
      clientId: 'client_test_user',
      username: 'testuser',
      password: 'password123',
      name: 'Test User',
      email: 'test@example.com',
      advisorId: 'advisor_main'
    });
    
    res.json({ success: true, message: 'Test user created', client: testClient });
    
  } catch (error) {
    // Log error for server-side debugging
    console.error('Error creating test user:', error);
    
    if (error.message && error.message.includes('UNIQUE constraint')) {
      res.json({ message: 'Test user already exists' });
    } else {
      // Never expose error details or stack traces
      res.status(500).json(sanitizeErrorResponse(error, 'Failed to create test user'));
    }
  }
});

// Force create test user (for development only - disabled in production)
app.post('/api/force-create-test-user', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  try {
    // Delete existing test users
    await Client.deleteOne({ clientId: 'client_test_user' });
    await Client.deleteOne({ username: 'testuser' });
    await Client.deleteOne({ email: 'test@example.com' });
    
    // Create fresh test user
    const testClient = await Client.create({
      clientId: 'client_test_user',
      username: 'testuser',
      password: 'password123',
      name: 'Test User',
      email: 'test@example.com',
      advisorId: 'advisor_main'
    });
    
    res.json({ success: true, message: 'Test user created successfully', client: testClient });
    
  } catch (error) {
    // Log full error for debugging in development
    console.error('Error creating test user:', error);
    
    // Never expose error details or stack traces
    const isProduction = process.env.NODE_ENV === 'production';
    res.status(500).json({ 
      success: false,
      error: 'Failed to create test user',
      // Only include error message in development
      ...(isProduction ? {} : { message: error.message })
    });
  }
});

// Debug test user (for development only - disabled in production)
app.get('/api/debug/testuser', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  try {
    const testUser = await Client.findOne({ clientId: 'client_test_user' });
    res.json(testUser);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// ADMIN ROUTES - Enhanced with new functionality
// =============================================================================

// Get all clients for admin dashboard (requires admin role)
app.get('/api/admin/clients', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Audit log: admin action
    logAdminAction('view_all_clients', req.user.clientId, null, req.ip);
    
    const clients = await Client.find({})
      .select('clientId name email plaidAccessTokens isActive advisorId createdAt')
      .sort({ name: 1 });
    
    res.json({ 
      success: true, 
      clients: clients.map(client => ({
        ...client.toObject(),
        plaidAccessTokens: client.plaidAccessTokens || []
      }))
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get transactions for a specific client and month (admin - requires authentication)
app.get('/api/admin/transactions/:clientId', requireAuth, async (req, res) => {
  try {
    // Validate that requested clientId matches authenticated user's clientId
    const requestedClientId = req.params.clientId;
    const authenticatedClientId = req.user.clientId;
    
    if (requestedClientId !== authenticatedClientId) {
      // Log security event: unauthorized access attempt
      logSecurityEvent('unauthorized_access_attempt', authenticatedClientId, req.ip, {
        requestedClientId,
        route: req.path,
        method: req.method
      });
      
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied: You can only access your own data' 
      });
    }
    
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { month } = req.query; // Format: "2025-01"
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const targetMonth = month || moment().format('YYYY-MM');
    
    // Use transactionsSync service to get from database (preferred method)
    const storedTransactions = await transactionsSync.getTransactionsFromDatabase(clientId, {
      month: targetMonth
    });

    // If we have stored transactions, return those
    if (storedTransactions.length > 0) {
      return res.json({
        success: true,
        client: {
          clientId: client.clientId,
          name: client.name,
          email: client.email
        },
        transactions: storedTransactions,
        source: 'database'
      });
    }

    // If no transactions in database, suggest syncing
    res.json({
      success: true,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email
      },
      transactions: [],
      source: 'database',
      message: 'No transactions found in database. Use POST /api/clients/:clientId/sync-transactions to fetch from Plaid using transactionsSync API.'
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get monthly summaries for a client (admin - requires authentication)
app.get('/api/admin/summaries/:clientId', requireAuth, async (req, res) => {
  try {
    // Validate that requested clientId matches authenticated user's clientId
    const requestedClientId = req.params.clientId;
    const authenticatedClientId = req.user.clientId;
    
    if (requestedClientId !== authenticatedClientId) {
      // Log security event: unauthorized access attempt
      logSecurityEvent('unauthorized_access_attempt', authenticatedClientId, req.ip, {
        requestedClientId,
        route: req.path,
        method: req.method
      });
      
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied: You can only access your own data' 
      });
    }
    
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const summaries = await MonthlySummary.find({ clientId })
      .sort({ date: -1 })
      .limit(24); // Last 2 years

    res.json({
      success: true,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email
      },
      summaries
    });
  } catch (error) {
    console.error('Error fetching summaries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save categorized transactions (admin - requires authentication) - Enhanced
app.post('/api/admin/save-categories/:clientId', requireAuth, async (req, res) => {
  try {
    // Validate that requested clientId matches authenticated user's clientId
    const requestedClientId = req.params.clientId;
    const authenticatedClientId = req.user.clientId;
    
    if (requestedClientId !== authenticatedClientId) {
      // Log security event: unauthorized access attempt
      logSecurityEvent('unauthorized_access_attempt', authenticatedClientId, req.ip, {
        requestedClientId,
        route: req.path,
        method: req.method
      });
      
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied: You can only access your own data' 
      });
    }
    
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { transactions, month } = req.body;

    // If we have Transaction model, save to database
    if (Transaction) {
      // Update or create transactions in bulk
      const updatePromises = transactions.map(async ({ transactionId, userCategory, isReviewed }) => {
        return await Transaction.findOneAndUpdate(
          { 
            $or: [
              { _id: transactionId },
              { plaidTransactionId: transactionId }
            ],
            clientId 
          },
          { 
            userCategory, 
            isReviewed: isReviewed !== undefined ? isReviewed : true
          },
          { new: true, upsert: false }
        );
      });

      await Promise.all(updatePromises);
    }

    // Also process for monthly summary
    await processAndSaveTransactions(clientId, transactions, month);

    res.json({ 
      success: true, 
      message: `Updated ${transactions.length} transactions` 
    });
  } catch (error) {
    console.error('Error saving categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Regenerate monthly summary (admin - requires authentication)
app.post('/api/admin/regenerate-summary/:clientId', requireAuth, async (req, res) => {
  try {
    // Validate that requested clientId matches authenticated user's clientId
    const requestedClientId = req.params.clientId;
    const authenticatedClientId = req.user.clientId;
    
    if (requestedClientId !== authenticatedClientId) {
      // Log security event: unauthorized access attempt
      logSecurityEvent('unauthorized_access_attempt', authenticatedClientId, req.ip, {
        requestedClientId,
        route: req.path,
        method: req.method
      });
      
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied: You can only access your own data' 
      });
    }
    
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { month } = req.body; // Format: "2025-01"

    let transactions = [];

    // Try to get transactions from database first
    if (Transaction) {
      transactions = await Transaction.find({
        clientId,
        monthYear: month
      });
    }

    // If no stored transactions, fetch from Plaid
    if (transactions.length === 0) {
      const client = await Client.findOne({ clientId });
      if (!client) {
        return res.status(404).json({ 
          success: false, 
          error: 'Client not found' 
        });
      }

      transactions = await fetchTransactionsFromPlaid(client, month);
    }

    if (transactions.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No transactions found for this month' 
      });
    }

    // Calculate summary data
    const summary = calculateMonthlySummary(transactions, clientId, month);

    // Update or create monthly summary
    const existingSummary = await MonthlySummary.findOneAndUpdate(
      { clientId, monthYear: month },
      summary,
      { new: true, upsert: true }
    );

    res.json({ 
      success: true, 
      summary: existingSummary,
      message: 'Monthly summary regenerated successfully'
    });
  } catch (error) {
    console.error('Error regenerating summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// CLIENT ROUTES - Enhanced
// =============================================================================

// Get transactions for client (user view) - Updated to use transactionsSync service
app.get('/api/clients/:clientId/transactions', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { month, months, limit = 100, startDate, endDate } = req.query;

    // Use transactionsSync service to get from database
    const transactions = await transactionsSync.getTransactionsFromDatabase(clientId, {
      month,
      months,
      limit: parseInt(limit),
      startDate,
      endDate
    });

    res.json({
      success: true,
      transactions,
      count: transactions.length,
      source: 'database',
      message: transactions.length === 0 
        ? 'No transactions found. Use POST /api/clients/:clientId/sync-transactions to fetch from Plaid.'
        : null
    });
  } catch (error) {
    console.error('Error fetching client transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update transaction categories (user)
app.post('/api/clients/:clientId/update-transaction-categories', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { transactions } = req.body;

    if (!Transaction) {
      return res.json({ 
        success: true, 
        message: 'Transaction updates saved (legacy mode)' 
      });
    }

    const updatePromises = transactions.map(({ transactionId, userCategory, isReviewed }) => {
      try {
        // Try to find by plaidTransactionId first (most reliable)
        let existing = Transaction.findOne({ 
          plaidTransactionId: transactionId,
          clientId 
        });
        
        // If not found, try by _id (which maps to plaidTransactionId in the model)
        if (!existing) {
          existing = Transaction.findOne({ 
            _id: transactionId,
            clientId 
          });
        }
        
        if (!existing) {
          console.warn(`Transaction not found: ${transactionId} for client ${clientId}`);
          return null;
        }
        
        // Update the transaction
        const updated = Transaction.findOneAndUpdate(
          { 
            plaidTransactionId: existing.plaidTransactionId,
            clientId 
          },
          { 
            userCategory, 
            isReviewed: isReviewed !== undefined ? isReviewed : true
          },
          { new: true }
        );
        
        return updated;
      } catch (err) {
        console.error(`Error updating transaction ${transactionId}:`, err);
        return null;
      }
    });

    const results = await Promise.all(updatePromises);
    const successCount = results.filter(r => r !== null).length;

    res.json({ 
      success: true, 
      message: `Updated ${successCount} of ${transactions.length} transactions`,
      updated: successCount,
      total: transactions.length
    });
  } catch (error) {
    console.error('Error updating transaction categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clear and refresh transactions (force reprocess with corrected logic)
app.post('/api/clients/:clientId/refresh-transactions', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { month } = req.body;
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    const targetMonth = month || moment().format('YYYY-MM');
    
    // Clear existing transactions for this month
    if (Transaction) {
      await Transaction.deleteMany({ 
        clientId, 
        monthYear: targetMonth 
      });
      console.log(`🗑️  Cleared existing transactions for ${clientId} in ${targetMonth}`);
    }

    // Fetch fresh transactions from Plaid with corrected logic
    const transactions = await fetchTransactionsFromPlaid(client, targetMonth);
    
    // Store the corrected transactions
    let totalStored = 0;
    if (Transaction && transactions.length > 0) {
      for (const transaction of transactions) {
        try {
          await Transaction.findOneAndUpdate(
            { plaidTransactionId: transaction.plaidTransactionId },
            transaction,
            { upsert: true, new: true }
          );
          totalStored++;
        } catch (error) {
          console.error('Error storing transaction:', error.message);
        }
      }
    }

    if (totalStored === 0) {
      return res.json({
        success: false,
        message: 'No valid bank connections found. Please connect a real bank account through Plaid Link.',
        totalStored: 0,
        month: targetMonth
      });
    }

    res.json({
      success: true,
      message: `Refreshed ${totalStored} transactions with corrected categorization`,
      totalStored,
      month: targetMonth
    });
  } catch (error) {
    console.error('Error refreshing transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Store transactions from Plaid connection
app.post('/api/clients/:clientId/store-transactions', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { months = 3 } = req.body || {}; // Default to last 3 months
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    let totalStored = 0;

    // Store transactions for the last N months
    for (let i = 0; i < months; i++) {
      const targetMonth = moment().subtract(i, 'months').format('YYYY-MM');
      const transactions = await fetchTransactionsFromPlaid(client, targetMonth);
      
      if (Transaction && transactions.length > 0) {
        // Store in database
        for (const transaction of transactions) {
          try {
            await Transaction.findOneAndUpdate(
              { plaidTransactionId: transaction.plaidTransactionId },
              transaction,
              { upsert: true, new: true }
            );
            totalStored++;
          } catch (error) {
            console.error('Error storing transaction:', error.message);
          }
        }
      }
    }

    res.json({
      success: true,
      message: `Stored ${totalStored} transactions`,
      totalStored
    });
  } catch (error) {
    console.error('Error storing transactions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// TRANSACTIONS SYNC ROUTES (using transactionsSync API)
// =============================================================================

// Sync transactions for a client using transactionsSync API
// This is the recommended way to fetch and store transactions
app.post('/api/clients/:clientId/sync-transactions', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const itemId = req.body?.itemId || null; // Optional: sync specific item only

    const result = await transactionsSync.syncTransactionsForClient(clientId, itemId);

    res.json({
      success: true,
      message: 'Transaction sync completed',
      ...result
    });
  } catch (error) {
    console.error('Error syncing transactions:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Sync investments for a client
app.post('/api/clients/:clientId/sync-investments', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;

    const result = await investmentsSync.syncInvestmentsForClient(clientId);

    res.json({
      success: true,
      message: 'Investment sync completed',
      ...result
    });
  } catch (error) {
    console.error('Error syncing investments:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get investment holdings for a client
app.get('/api/clients/:clientId/investments', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    
    const investments = Investment.find({ clientId });
    
    console.log(`📊 Found ${investments.length} investments for client ${clientId}`);
    if (investments.length > 0) {
      const totalValue = investments.reduce((sum, inv) => sum + (inv.value || 0), 0);
      console.log(`💰 Total investment value: $${totalValue.toFixed(2)}`);
      console.log(`📈 Sample investment:`, investments[0]);
    }
    
    // Organize investments by tax type and calculate totals
    const organized = organizeInvestmentsByTaxType(investments);
    
    // Calculate asset class breakdown
    const assetClassBreakdown = investmentSnapshot.calculateAssetClassBreakdown(investments);
    
    console.log(`📊 Organized totalValue: $${organized.totalValue.toFixed(2)}`);
    console.log(`📊 Asset class breakdown:`, assetClassBreakdown);
    
    res.json({
      success: true,
      investments: organized,
      totalValue: organized.totalValue,
      totalByTaxType: organized.totalByTaxType,
      holdingsByAccount: organized.holdingsByAccount,
      assetClassBreakdown
    });
  } catch (error) {
    console.error('Error fetching investments:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// =============================================================================
// BALANCE SHEET SNAPSHOT ROUTES
// =============================================================================

// Capture balance sheet snapshot for a client (admin/automated)
app.post('/api/clients/:clientId/balance-sheet-snapshot', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { snapshotDate } = req.body; // Optional: YYYY-MM-DD format
    
    const snapshot = await balanceSheetSnapshot.captureBalanceSheetSnapshot(clientId, snapshotDate);
    
    res.json({
      success: true,
      message: 'Balance sheet snapshot captured successfully',
      snapshot
    });
  } catch (error) {
    console.error('Error capturing balance sheet snapshot:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get balance sheet snapshots for a client
app.get('/api/clients/:clientId/balance-sheets', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { startDate, endDate, limit = 50 } = req.query;
    
    let query = { clientId };
    
    if (startDate) {
      query.snapshotDate = { $gte: startDate };
    }
    if (endDate) {
      query.snapshotDate = { ...query.snapshotDate, $lte: endDate };
    }
    
    const snapshots = await BalanceSheet.find(query, { limit: parseInt(limit) });
    
    res.json({
      success: true,
      snapshots,
      count: snapshots.length
    });
  } catch (error) {
    console.error('Error fetching balance sheet snapshots:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Admin route: Capture snapshots for all clients (for scheduled jobs - requires authentication)
// NOTE: This route captures snapshots for ALL clients, not just the authenticated user
// In production, this should be restricted to admin users only
app.post('/api/admin/capture-all-balance-sheets', requireAuth, requireAdmin, async (req, res) => {
  try {
    // This route operates on all clients - requires admin role
    const { snapshotDate } = req.body; // Optional: YYYY-MM-DD format
    
    // Audit log: admin action
    logAdminAction('capture_all_balance_sheets', req.user.clientId, null, req.ip, { snapshotDate });
    
    const results = await balanceSheetSnapshot.captureAllClientsSnapshots(snapshotDate);
    
    res.json({
      success: true,
      message: 'Balance sheet snapshots captured for all clients',
      results
    });
  } catch (error) {
    console.error('Error capturing balance sheet snapshots:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Capture investment snapshot for a client
app.post('/api/clients/:clientId/investment-snapshot', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { snapshotDate } = req.body; // Optional: YYYY-MM-DD format
    
    const snapshot = await investmentSnapshot.captureInvestmentSnapshot(clientId, snapshotDate);
    
    res.json({
      success: true,
      message: 'Investment snapshot captured successfully',
      snapshot
    });
  } catch (error) {
    console.error('Error capturing investment snapshot:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get investment snapshots for a client
app.get('/api/clients/:clientId/investment-snapshots', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { startDate, endDate, limit = 50 } = req.query;
    
    let query = { clientId };
    
    if (startDate) {
      query.snapshotDate = { $gte: startDate };
    }
    if (endDate) {
      query.snapshotDate = { ...query.snapshotDate, $lte: endDate };
    }
    
    const snapshots = await InvestmentSnapshot.find(query, { limit: parseInt(limit) });
    
    res.json({
      success: true,
      snapshots,
      count: snapshots.length
    });
  } catch (error) {
    console.error('Error fetching investment snapshots:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Admin route: Capture investment snapshots for all clients (for scheduled jobs - requires admin role)
// NOTE: This route captures snapshots for ALL clients - requires admin role
app.post('/api/admin/capture-all-investment-snapshots', requireAuth, requireAdmin, async (req, res) => {
  try {
    // This route operates on all clients - requires admin role
    const { snapshotDate } = req.body; // Optional: YYYY-MM-DD format
    
    // Audit log: admin action
    logAdminAction('capture_all_investment_snapshots', req.user.clientId, null, req.ip, { snapshotDate });
    
    const results = await investmentSnapshot.captureAllClientsInvestmentSnapshots(snapshotDate);
    
    res.json({
      success: true,
      message: 'Investment snapshots captured for all clients',
      results
    });
  } catch (error) {
    console.error('Error capturing investment snapshots:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// =============================================================================
// EXISTING ROUTES (maintained for compatibility)
// =============================================================================

// Update client profile
app.put('/api/clients/:clientId/profile', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const profileData = req.body;
    
    const client = await Client.findOneAndUpdate(
      { clientId },
      { clientProfile: profileData },
      { new: true }
    );
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json({ success: true, profile: client.clientProfile });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Plaid routes
app.post('/api/create_link_token', requireAuth, plaidLimiter, async (req, res) => {
  try {
    // Derive clientId from authenticated JWT token
    const clientId = req.user.clientId;

    const request = {
      user: {
        client_user_id: clientId
      },
      client_name: "Financial Advisory System",
      products: ['transactions', 'investments', 'assets'],
      country_codes: ['US'],
      language: 'en'
    };

    const response = await plaidClient.linkTokenCreate(request);
    res.json({ 
      link_token: response.data.link_token,
      expiration: response.data.expiration
    });
  } catch (error) {
    console.error('Error creating link token:', error);
    res.status(500).json({ 
      error: error.message,
      plaid_error: error.response?.data || null
    });
  }
});

app.post('/api/exchange_public_token', requireAuth, plaidLimiter, async (req, res) => {
  try {
    const { public_token } = req.body;
    
    if (!public_token) {
      return res.status(400).json({ error: 'public_token is required' });
    }

    // Derive clientId from authenticated JWT token
    const clientId = req.user.clientId;

    // Exchange token with Plaid
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: public_token
    });
    
    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    // Get institution info
    const itemResponse = await plaidClient.itemGet({
      access_token: accessToken
    });
    
    const institutionId = itemResponse.data.item.institution_id;
    
    // Get institution details
    const institutionResponse = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: ['US']
    });
    
    const institutionName = institutionResponse.data.institution.name;

    // Get account information
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken
    });
    
    const accountIds = accountsResponse.data.accounts.map(account => account.account_id);

    console.log(`✅ New access token created for client: ${clientId}`);
    console.log(`   Institution: ${institutionName}`);
    console.log(`   Item ID: ${itemId}`);
    console.log(`   Accounts: ${accountIds.length} accounts connected`);
    
    res.json({ 
      success: true,
      item_id: itemId,
      institution_name: institutionName,
      institution_id: institutionId,
      account_ids: accountIds,
      access_token: accessToken,
      message: 'Bank account connected successfully'
    });
  } catch (error) {
    console.error('Error exchanging public token:', error);
    res.status(500).json({ 
      error: error.message,
      plaid_error: error.response?.data || null
    });
  }
});

// Add Plaid token to client
app.post('/api/clients/:clientId/plaid-token', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { accessToken, itemId, institutionName, institutionId, accountIds } = req.body;
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Add the new Plaid connection
    client.plaidAccessTokens.push({
      accessToken,
      itemId,
      institutionName,
      institutionId,
      accountIds,
      isActive: true,
      connectedAt: new Date(),
      transactionCursor: null // Initialize cursor for transactionsSync
    });

    await client.save();

    res.json({
      success: true,
      message: `Added ${institutionName} to client ${client.name}`,
      totalConnections: client.plaidAccessTokens.length
    });
  } catch (error) {
    console.error('Error saving Plaid token:', error);
    res.status(500).json({ error: error.message });
  }
});

// NOTE: Direct Plaid proxy routes using access_token in URL
// were removed for security reasons.
// Use client-based, database-first routes instead:
// - /api/clients/:clientId/transactions (GET) - Get transactions from database
// - /api/clients/:clientId/sync-transactions (POST) - Sync from Plaid to database
// - /api/clients/:clientId/investments (GET) - Get investments from database
// - /api/clients/:clientId/sync-investments (POST) - Sync from Plaid to database

// Transaction processing route (updated)
app.post('/api/process-transactions/:clientId', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { useUserCategories = false, targetMonth } = req.body || {};
    
    const TransactionProcessor = require('./services/transactionProcessor');
    const summary = await TransactionProcessor.processClientMonth(clientId, targetMonth, useUserCategories);
    
    res.json({
      success: true,
      message: 'Transactions processed successfully',
      summary: summary
    });
  } catch (error) {
    console.error('Error processing transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Legacy transaction review routes (maintained for compatibility)
app.get('/api/review-transactions/:clientId', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { month } = req.query;
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const targetMonth = month || moment().format('YYYY-MM');
    const transactions = await fetchTransactionsFromPlaid(client, targetMonth);

    res.json({
      transactions: transactions.map(t => ({
        id: t.plaidTransactionId || t._id,
        name: t.name,
        merchant_name: t.merchantName,
        amount: Math.abs(t.amount),
        date: t.date,
        originalCategory: t.category,
        suggestedCategory: t.suggestedCategory,
        isIncome: t.amount > 0,
        account_name: t.accountId
      })),
      count: transactions.length,
      month: targetMonth,
      client: { name: client.name, clientId: client.clientId }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/save-categorized-transactions/:clientId', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { transactions, month } = req.body;
    
    // Process transactions and create summary
    const summary = await processAndSaveTransactions(clientId, transactions, month);
    
    res.json({
      success: true,
      message: 'Transactions categorized and saved',
      summary: summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test routes (for development only - disabled in production)
app.get('/api/test_plaid', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  try {
    const request = {
      user: {
        client_user_id: 'test-user-' + Date.now()
      },
      client_name: "Test Connection",
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en'
    };

    const response = await plaidClient.linkTokenCreate(request);
    res.json({
      status: 'success',
      message: 'Plaid connection working',
      link_token_created: true,
      environment: process.env.PLAID_ENV,
      database_status: 'connected (SQLite)'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Plaid connection failed',
      error: error.message
    });
  }
});

app.post('/api/test-connect-bank/:clientId', requireAuth, ensureClientOwnership, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    client.plaidAccessTokens.push({
      accessToken: 'access-sandbox-test-token',
      itemId: 'test-item-id',
      institutionName: 'First Platypus Bank',
      institutionId: 'ins_109508',
      accountIds: ['account-1', 'account-2']
    });

    await client.save();
    
    res.json({ 
      success: true, 
      message: 'Test bank connection added',
      note: 'This is a test connection for development'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/test-real-plaid/:clientId', requireAuth, ensureClientOwnership, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    
    const linkRequest = {
      user: { client_user_id: clientId },
      client_name: "Test Financial System",
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en'
    };

    const linkResponse = await plaidClient.linkTokenCreate(linkRequest);
    
    res.json({
      success: true,
      message: 'Real Plaid test ready',
      link_token: linkResponse.data.link_token,
      instructions: 'Use this link_token with Plaid Link to connect a sandbox bank account'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// Fetch transactions from Plaid for a specific month
async function fetchTransactionsFromPlaid(client, targetMonth) {
  const year = parseInt(targetMonth.split('-')[0]);
  const monthNum = parseInt(targetMonth.split('-')[1]);
  
  const startDate = moment(`${year}-${monthNum.toString().padStart(2, '0')}-01`).format('YYYY-MM-DD');
  const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');

  let allTransactions = [];
  
  // Try to require TransactionProcessor, fallback if not available
  let TransactionProcessor;
  try {
    TransactionProcessor = require('./services/transactionProcessor');
  } catch (error) {
    console.log('TransactionProcessor not found, using basic categorization');
    TransactionProcessor = {
      categorizeTransaction: (t) => ({ subCategory: 'uncategorized' })
    };
  }

  for (const plaidConnection of client.plaidAccessTokens || []) {
    if (!plaidConnection.isActive) continue;
    
    // Skip test/fake access tokens
    if (plaidConnection.accessToken === 'access-sandbox-test-token' || 
        plaidConnection.accessToken.startsWith('test-') ||
        plaidConnection.accessToken.includes('fake')) {
      console.log(`⚠️  Skipping test connection: ${plaidConnection.institutionName}`);
      continue;
    }

    try {
      // First get account info to determine account types
      const accountsResponse = await plaidClient.accountsGet({
        access_token: plaidConnection.accessToken
      });
      
      // Create a map of account_id to account_type
      const accountTypeMap = {};
      accountsResponse.data.accounts.forEach(account => {
        accountTypeMap[account.account_id] = account.type;
      });
      
      const response = await plaidClient.transactionsGet({
        access_token: plaidConnection.accessToken,
        start_date: startDate,
        end_date: endDate,
        options: {
          include_personal_finance_category: true
        }
      });

      // Create account maps for type, subtype, name, and mask
      const accountSubtypeMap = {};
      const accountNameMap = {};
      const accountMaskMap = {};
      accountsResponse.data.accounts.forEach(account => {
        accountSubtypeMap[account.account_id] = account.subtype;
        
        // Create human-readable account name
        const typeLabel = account.type === 'credit' ? 'Credit Card' : 
                         account.type === 'depository' ? (account.subtype === 'checking' ? 'Checking' : account.subtype === 'savings' ? 'Savings' : 'Depository') :
                         account.type === 'loan' ? 'Loan' :
                         account.type === 'investment' ? 'Investment' : account.type;
        
        accountNameMap[account.account_id] = account.name || `${typeLabel} ${account.mask ? `****${account.mask}` : ''}`.trim();
        accountMaskMap[account.account_id] = account.mask || null;
      });

      const transactions = response.data.transactions.map(t => {
        // Get account type and subtype for this transaction
        const accountId = t.account_id;
        const accountType = accountTypeMap[accountId] || null;
        const accountSubtype = accountSubtypeMap[accountId] || null;
        const categorized = TransactionProcessor.categorizeTransaction(t, accountType);
        return {
          _id: t.transaction_id,
          plaidTransactionId: t.transaction_id,
          clientId: client.clientId,
          accountId: accountId,
          accountType: accountType,
          accountSubtype: accountSubtype,
          accountName: accountNameMap[accountId] || null,
          accountMask: accountMaskMap[accountId] || null,
          name: t.name,
          merchantName: t.merchant_name,
          amount: t.amount,
          date: t.date,
          // Legacy category (deprecated - kept for backward compatibility)
          category: t.category || [],
          plaidCategory: t.category?.[0] || null,
          plaidSubCategory: t.category?.[1] || null,
          // Personal Finance Category (new, more accurate - preferred)
          personalFinanceCategory: t.personal_finance_category ? {
            primary: t.personal_finance_category.primary,
            detailed: t.personal_finance_category.detailed,
            confidence: t.personal_finance_category.confidence
          } : null,
          suggestedCategory: categorized.subCategory,
          userCategory: null,
          isReviewed: false,
          monthYear: targetMonth,
          notes: null,
          institution: plaidConnection.institutionName
        };
      });

      allTransactions = [...allTransactions, ...transactions];
    } catch (error) {
      console.error(`Error fetching transactions for ${plaidConnection.institutionName}:`, error.message);
    }
  }

  return allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Calculate monthly summary from transactions
function calculateMonthlySummary(transactions, clientId, monthYear) {
  const summary = {
    clientId,
    monthYear,
    date: moment(monthYear).endOf('month').toDate(),
    year: parseInt(monthYear.split('-')[0]),
    cashFlow: {
      income: 0,
      totalExpenses: 0,
      housing: 0,
      billAndUtilities: 0,
      autoAndTransport: 0,
      insurance: 0,
      loanPayment: 0,
      groceries: 0,
      healthAndFitness: 0,
      shopping: 0,
      diningOut: 0,
      entertainment: 0,
      travel: 0,
      charitableGiving: 0,
      business: 0,
      kids: 0,
      education: 0,
      gift: 0,
      misc: 0,
      uncategorized: 0,
      feeAndCharges: 0
    },
    netWorth: {
      assets: 0,
      liabilities: 0,
      netWorth: 0,
      assetBreakdown: {
        checking: 0,
        savings: 0,
        investments: 0,
        realEstate: 0
      },
      liabilityBreakdown: {
        creditCards: 0,
        studentLoans: 0,
        mortgage: 0
      }
    },
    transactionsProcessed: transactions.length,
    lastProcessedAt: new Date()
  };

  // Process transactions using account type to determine income vs expense
  transactions.forEach(transaction => {
    const amount = Math.abs(transaction.amount);
    const category = transaction.userCategory || transaction.suggestedCategory || 'uncategorized';
    const accountType = transaction.accountType;
    
    // Determine if income or expense based on account type
    let isIncome = false;
    
    if (accountType === 'credit') {
      // Credit cards: positive = charge (expense), negative = payment (expense)
      isIncome = false;
    } else if (accountType === 'depository') {
      // Checking/savings: positive = income, negative = expense
      isIncome = transaction.amount > 0;
    } else if (accountType === 'loan') {
      // Loans: positive = loan received (income), negative = payment (expense)
      isIncome = transaction.amount > 0;
    } else {
      // Default: positive = income, negative = expense
      isIncome = transaction.amount > 0;
    }
    
    if (isIncome) {
      summary.cashFlow.income += amount;
    } else {
      // Expense - add to appropriate category
      if (summary.cashFlow.hasOwnProperty(category)) {
        summary.cashFlow[category] += amount;
      } else {
        summary.cashFlow.uncategorized += amount;
      }
    }
  });

  // Calculate total expenses
  summary.cashFlow.totalExpenses = Object.keys(summary.cashFlow)
    .filter(key => !['income', 'totalExpenses', 'difference', 'averageIncome', 'averageExpense'].includes(key))
    .reduce((total, key) => total + summary.cashFlow[key], 0);

  summary.cashFlow.difference = summary.cashFlow.income - summary.cashFlow.totalExpenses;

  return summary;
}

// Process and save transactions (enhanced version)
async function processAndSaveTransactions(clientId, transactions, month) {
  const year = parseInt(month.split('-')[0]);
  
  let monthlyData = {
    clientId,
    monthYear: month,
    date: moment(month).endOf('month').toDate(),
    year,
    cashFlow: {
      income: 0,
      totalExpenses: 0,
      // Initialize all expense categories to 0
      housing: 0, billAndUtilities: 0, autoAndTransport: 0, insurance: 0,
      loanPayment: 0, groceries: 0, healthAndFitness: 0, shopping: 0,
      diningOut: 0, entertainment: 0, travel: 0, misc: 0,
      charitableGiving: 0, business: 0, kids: 0, education: 0,
      gift: 0, uncategorized: 0, feeAndCharges: 0
    },
    netWorth: {
      assets: 0,
      liabilities: 0,
      netWorth: 0,
      assetBreakdown: {
        checking: 0,
        savings: 0,
        investments: 0,
        realEstate: 0,
        total: 0
      },
      liabilityBreakdown: {
        creditCards: 0,
        studentLoans: 0,
        mortgage: 0,
        total: 0
      }
    },
    transactionsProcessed: transactions.length,
    reviewStatus: 'reviewed',
    lastProcessedAt: new Date()
  };

  // Aggregate transactions into categories
  transactions.forEach(t => {
    const amount = typeof t.amount === 'number' ? Math.abs(t.amount) : Math.abs(parseFloat(t.amount) || 0);
    
    if (t.isIncome || (t.amount && t.amount > 0)) {
      monthlyData.cashFlow.income += amount;
    } else {
      const category = t.finalCategory || t.userCategory || t.suggestedCategory || 'uncategorized';
      if (monthlyData.cashFlow.hasOwnProperty(category)) {
        monthlyData.cashFlow[category] = (monthlyData.cashFlow[category] || 0) + amount;
      } else {
        monthlyData.cashFlow.uncategorized = (monthlyData.cashFlow.uncategorized || 0) + amount;
      }
    }
  });

  // Calculate total expenses
  monthlyData.cashFlow.totalExpenses = Object.keys(monthlyData.cashFlow)
    .filter(key => !['income', 'totalExpenses', 'averageExpense', 'averageIncome', 'difference'].includes(key))
    .reduce((total, key) => total + (monthlyData.cashFlow[key] || 0), 0);

  // Calculate difference
  monthlyData.cashFlow.difference = monthlyData.cashFlow.income - monthlyData.cashFlow.totalExpenses;

  // Get net worth data from connected accounts
  try {
    const client = await Client.findOne({ clientId });
    if (client && client.plaidAccessTokens) {
      for (const plaidConnection of client.plaidAccessTokens) {
        if (!plaidConnection.isActive) continue;
        
        try {
          const accountsResponse = await plaidClient.accountsGet({
            access_token: plaidConnection.accessToken
          });
          
          for (const account of accountsResponse.data.accounts) {
            const balance = account.balances.current || 0;
            
            // Categorize accounts into assets and liabilities
            switch (account.type) {
              case 'depository':
                if (account.subtype === 'checking') {
                  monthlyData.netWorth.assetBreakdown.checking += balance;
                } else if (account.subtype === 'savings') {
                  monthlyData.netWorth.assetBreakdown.savings += balance;
                }
                monthlyData.netWorth.assets += balance;
                break;
                
              case 'investment':
                monthlyData.netWorth.assetBreakdown.investments += balance;
                monthlyData.netWorth.assets += balance;
                break;
                
              case 'credit':
                monthlyData.netWorth.liabilityBreakdown.creditCards += Math.abs(balance);
                monthlyData.netWorth.liabilities += Math.abs(balance);
                break;
                
              case 'loan':
                if (account.subtype === 'mortgage') {
                  monthlyData.netWorth.liabilityBreakdown.mortgage += Math.abs(balance);
                } else if (account.subtype === 'student') {
                  monthlyData.netWorth.liabilityBreakdown.studentLoans += Math.abs(balance);
                }
                monthlyData.netWorth.liabilities += Math.abs(balance);
                break;
            }
          }
        } catch (error) {
          console.error('Error getting account balances:', error.message);
        }
      }
    }
  } catch (error) {
    console.error('Error processing net worth:', error.message);
  }

  // Calculate net worth totals
  monthlyData.netWorth.assetBreakdown.total = monthlyData.netWorth.assets;
  monthlyData.netWorth.liabilityBreakdown.total = monthlyData.netWorth.liabilities;
  monthlyData.netWorth.netWorth = monthlyData.netWorth.assets - monthlyData.netWorth.liabilities;

  // Calculate client profile data
  monthlyData.clientProfile = {
    savingsRate: monthlyData.cashFlow.income > 0 ? (monthlyData.cashFlow.difference / monthlyData.cashFlow.income) * 100 : 0,
    investmentRate: 0, // Could be calculated based on investment contributions
    currentIncome: monthlyData.cashFlow.income
  };

  // Save to database
  const savedSummary = await MonthlySummary.findOneAndUpdate(
    { clientId, monthYear: month },
    monthlyData,
    { upsert: true, new: true }
  );

  return savedSummary;
}

// Get client summaries (with limit)
app.get('/api/clients/:clientId/summaries', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { limit = 12 } = req.query;
    
    const summaries = await MonthlySummary.find({ clientId })
      .sort({ date: -1 })
      .limit(parseInt(limit));
    
    res.json({
      success: true,
      summaries
    });
  } catch (error) {
    console.error('Error fetching summaries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  // Log full error details for server-side debugging
  console.error('Unhandled error:', error);
  
  // Never expose stack traces or error details in production
  const isProduction = process.env.NODE_ENV === 'production';
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    // Only include error message in development for debugging
    ...(isProduction ? {} : { message: error.message })
  });
});

// Start server
/**
 * Organize investments by tax type and account
 * Returns structured data for frontend display
 */
function organizeInvestmentsByTaxType(investments) {
  const totalByTaxType = {
    'tax-free': 0,
    'tax-deferred': 0,
    'taxable': 0
  };
  
  const holdingsByAccount = {};
  const holdingsBySecurity = {};
  
  let totalValue = 0;
  
  // First pass: calculate totals and group by account
  investments.forEach(inv => {
    const value = inv.value || 0;
    totalValue += value;
    
    const taxType = inv.accountTaxType || 'taxable';
    totalByTaxType[taxType] = (totalByTaxType[taxType] || 0) + value;
    
    // Group by account
    const accountKey = `${inv.accountId}_${inv.accountName}`;
    if (!holdingsByAccount[accountKey]) {
      holdingsByAccount[accountKey] = {
        accountId: inv.accountId,
        accountName: inv.accountName,
        accountType: inv.accountType,
        accountSubtype: inv.accountSubtype,
        accountTaxType: taxType,
        institutionName: inv.institutionName,
        totalValue: 0,
        holdings: []
      };
    }
    
    holdingsByAccount[accountKey].totalValue += value;
    holdingsByAccount[accountKey].holdings.push({
      securityId: inv.securityId,
      securityName: inv.securityName,
      securityTicker: inv.securityTicker,
      securityType: inv.securityType,
      quantity: inv.quantity,
      price: inv.price,
      value: value,
      costBasis: inv.costBasis,
      percentage: 0 // Will be calculated in second pass
    });
    
    // Group by security across all accounts
    const securityKey = inv.securityId;
    if (!holdingsBySecurity[securityKey]) {
      holdingsBySecurity[securityKey] = {
        securityId: inv.securityId,
        securityName: inv.securityName,
        securityTicker: inv.securityTicker,
        securityType: inv.securityType,
        totalValue: 0,
        accounts: []
      };
    }
    
    holdingsBySecurity[securityKey].totalValue += value;
    holdingsBySecurity[securityKey].accounts.push({
      accountId: inv.accountId,
      accountName: inv.accountName,
      accountTaxType: taxType,
      value: value,
      quantity: inv.quantity
    });
  });
  
  // Second pass: calculate percentages
  Object.values(holdingsByAccount).forEach(account => {
    account.holdings.forEach(holding => {
      holding.percentage = account.totalValue > 0 
        ? (holding.value / account.totalValue) * 100 
        : 0;
    });
    // Sort holdings by value (descending)
    account.holdings.sort((a, b) => b.value - a.value);
  });
  
  // Sort accounts by total value (descending)
  const sortedAccounts = Object.values(holdingsByAccount)
    .sort((a, b) => b.totalValue - a.totalValue);
  
  // Sort securities by total value (descending)
  const sortedSecurities = Object.values(holdingsBySecurity)
    .sort((a, b) => b.totalValue - a.totalValue);
  
  return {
    totalValue,
    totalByTaxType,
    holdingsByAccount: sortedAccounts,
    holdingsBySecurity: sortedSecurities
  };
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Visit: http://localhost:${PORT}`);
  console.log(`🔧 Environment: ${process.env.PLAID_ENV || 'sandbox'}`);
  console.log(`🔑 Plaid Client ID: ${process.env.PLAID_CLIENT_ID ? '✅ Found' : '❌ Missing'}`);
  console.log(`🔐 Plaid Secret: ${process.env.PLAID_SECRET ? '✅ Found' : '❌ Missing'}`);
  console.log(`💾 Database: ✅ SQLite (plaid-financial-system.db)`);
  
  // Log available models
  console.log(`📊 Transaction Model: ${Transaction ? '✅ Available' : '⚠️  Not available - using legacy mode'}`);
  console.log(`📈 MonthlySummary Model: ${MonthlySummary ? '✅ Available' : '❌ Missing'}`);
  console.log(`👤 Client Model: ${Client ? '✅ Available' : '❌ Missing'}`);
});