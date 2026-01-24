// Load environment variables based on NODE_ENV or ENV_FILE override
// Allows using .env.production for real banking even when NODE_ENV=development
const envFile = process.env.ENV_FILE || 
  (process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development');
require('dotenv').config({ path: envFile });
console.log(`📁 Loading environment from: ${envFile}`);

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const moment = require('moment');
const bcrypt = require('bcrypt');

// Initialize Supabase database
const { initDatabase } = require('./database-supabase');
initDatabase();

// Import Supabase models
const Client = require('./models-supabase/Client');
const Transaction = require('./models-supabase/Transaction');
const MonthlySummary = require('./models-supabase/MonthlySummary');
const Investment = require('./models-supabase/Investment');
const BalanceSheet = require('./models-supabase/BalanceSheet');
const InvestmentSnapshot = require('./models-supabase/InvestmentSnapshot');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Render)

// Import routes
const clientRoutes = require('./routes/clients');
const inviteRoutes = require('./routes/invites');

// Import services
const transactionsSync = require('./services/transactionsSync');
const investmentsSync = require('./services/investmentsSync');
const balanceSheetSnapshot = require('./services/balanceSheetSnapshot');
const investmentSnapshot = require('./services/investmentSnapshot');
const { requireAuth, ensureClientOwnership, requireAdmin, supabase } = require('./middleware/auth');
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
// CORS configuration - allow both development and production frontends
const allowedOrigins = [
  'http://localhost:3000',
  'https://plaid-financial-system-frontend.onrender.com', // Production frontend
  'https://plaid-financial-system-api.onrender.com',
  process.env.FRONTEND_URL // Allow custom frontend URL from env
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Type', 'Authorization']
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
let plaidClient;
try {
  const { createPlaidClient, getPlaidEnvironment } = require('./utils/plaidConfig');
  const plaidBasePath = getPlaidEnvironment();
  console.log(`🔧 Plaid Environment: ${process.env.PLAID_ENV || 'sandbox'} (basePath: ${plaidBasePath})`);
  plaidClient = createPlaidClient();
  console.log(`✅ Plaid client initialized successfully`);
} catch (error) {
  console.error('❌ Failed to initialize Plaid client:', error);
  throw error; // Fail fast if Plaid can't be initialized
}

// Basic routes
app.get('/', (req, res) => {
  res.json({
    message: 'Plaid Financial System API is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.PLAID_ENV || 'sandbox',
    database: 'connected (Supabase/PostgreSQL)'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'Server is healthy',
    uptime: process.uptime(),
    plaid_env: process.env.PLAID_ENV,
    database_status: 'connected (Supabase/PostgreSQL)'
  });
});

// Client management routes
app.use('/api/clients', clientRoutes);

// Invite routes
app.use('/api/invites', inviteRoutes);

// =============================================================================
// AUTHENTICATION ROUTES
// =============================================================================
// NOTE: Authentication is now handled by Supabase Auth on the frontend
// The backend only verifies Supabase JWT tokens using the requireAuth middleware
// Old login/register/logout routes have been removed

// Optional: Endpoint to get current user info (requires authentication)
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user.clientId,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user information'
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
    
    const clients = await Client.find({});
    
    // Remove sensitive access tokens from response
    const safeClients = clients.map(client => {
      const clientObj = client.toObject ? client.toObject() : client;
      const { plaidAccessTokens, ...safeClient } = clientObj;
      
      // Return plaidAccessTokens without accessToken field
      if (plaidAccessTokens && plaidAccessTokens.length > 0) {
        safeClient.plaidAccessTokens = plaidAccessTokens.map(token => {
          const { accessToken, ...safeToken } = token;
          return safeToken; // Return token info without sensitive accessToken
        });
      } else {
        safeClient.plaidAccessTokens = [];
      }
      
      return safeClient;
    });
    
    res.json({ 
      success: true, 
      clients: safeClients
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

    // MonthlySummary.find() already orders by date descending
    const allSummaries = await MonthlySummary.find({ clientId });
    const summaries = allSummaries.slice(0, 24); // Last 2 years

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
// Investments endpoint disabled - investments functionality removed
app.post('/api/clients/:clientId/sync-investments', requireAuth, ensureClientOwnership, async (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Investments functionality has been removed' 
  });
});

// Investments endpoint disabled - investments functionality removed
app.get('/api/clients/:clientId/investments', requireAuth, ensureClientOwnership, async (req, res) => {
  res.json({
    success: true,
    investments: { totalValue: 0, totalByTaxType: { 'tax-free': 0, 'tax-deferred': 0, 'taxable': 0 }, holdingsByAccount: [], holdingsBySecurity: [] },
    totalValue: 0,
    totalByTaxType: { 'tax-free': 0, 'tax-deferred': 0, 'taxable': 0 },
    holdingsByAccount: [],
    assetClassBreakdown: {}
  });
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
// SOCIAL SECURITY DATA ROUTES
// =============================================================================

const SocialSecurity = require('./models-supabase/SocialSecurity');

// Get Social Security data for a client (Admin only)
app.get('/api/admin/clients/:clientId/social-security', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;

    const ssData = await SocialSecurity.findOne({ clientId });

    if (!ssData) {
      return res.json({ success: true, data: null });
    }

    res.json({ success: true, data: ssData });
  } catch (error) {
    console.error('Error fetching Social Security data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create or update Social Security data for a client (Admin only)
app.post('/api/admin/clients/:clientId/social-security', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const ssData = req.body;

    // Validate required fields
    if (!ssData.dateOfBirth) {
      return res.status(400).json({ success: false, error: 'Date of birth is required' });
    }

    // Calculate current age
    const currentAge = moment().diff(moment(ssData.dateOfBirth), 'years');

    // Calculate present value if we have benefit and start age
    if (ssData.estimatedMonthlyBenefit && ssData.estimatedSsaStartAge) {
      const lifeExpectancy = 90; // Default life expectancy
      const discountRate = 0.03; // Default 3% discount rate
      const inflationRate = 0.025; // Default 2.5% COLA

      // Calculate PV with COLA inflation adjustment
      ssData.presentValueOfBenefits = SocialSecurity.calculatePresentValue(
        parseFloat(ssData.estimatedMonthlyBenefit),
        parseInt(ssData.estimatedSsaStartAge),
        currentAge,
        lifeExpectancy,
        discountRate,
        inflationRate
      );

      console.log(`💰 Calculated Social Security PV: $${ssData.presentValueOfBenefits.toLocaleString()} (with ${(inflationRate * 100)}% COLA)`);
    }

    // Upsert Social Security data
    const result = await SocialSecurity.findOneAndUpdate(
      { clientId },
      { ...ssData, clientId },
      { upsert: true, new: true }
    );

    console.log(`✅ Social Security data saved for client ${clientId}`);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error saving Social Security data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update specific fields of Social Security data (Admin only)
app.put('/api/admin/clients/:clientId/social-security/:ssId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const updateData = req.body;

    // Get existing data to calculate age
    const existing = await SocialSecurity.findOne({ clientId });
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Social Security data not found' });
    }

    // Recalculate present value if benefit or start age changed
    if (updateData.estimatedMonthlyBenefit !== undefined || updateData.estimatedSsaStartAge !== undefined) {
      const dateOfBirth = updateData.dateOfBirth || existing.dateOfBirth;
      const currentAge = moment().diff(moment(dateOfBirth), 'years');
      const benefit = updateData.estimatedMonthlyBenefit || existing.estimatedMonthlyBenefit;
      const startAge = updateData.estimatedSsaStartAge || existing.estimatedSsaStartAge;

      if (benefit && startAge) {
        // Use improved formula with COLA
        updateData.presentValueOfBenefits = SocialSecurity.calculatePresentValue(
          parseFloat(benefit),
          parseInt(startAge),
          currentAge,
          90,
          0.03,
          0.025 // 2.5% COLA
        );

        console.log(`💰 Recalculated Social Security PV: $${updateData.presentValueOfBenefits.toLocaleString()} (with 2.5% COLA)`);
      }
    }

    const result = await SocialSecurity.findOneAndUpdate(
      { clientId },
      updateData,
      { new: true }
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error updating Social Security data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload SSA statement (Admin only)
app.post('/api/admin/clients/:clientId/social-security/upload-statement', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ success: false, error: 'File path is required' });
    }

    // Update statement upload path
    const result = await SocialSecurity.findOneAndUpdate(
      { clientId },
      { statementUploadPath: filePath, lastUpdated: new Date().toISOString().split('T')[0] },
      { upsert: true, new: true }
    );

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error uploading SSA statement:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get optimal claiming age analysis (Admin only)
app.get('/api/admin/clients/:clientId/social-security/optimal-age', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const {
      lifeExpectancy = 90,
      discountRate = 0.03,
      inflationRate = 0.025 // 2.5% COLA
    } = req.query;

    const ssData = await SocialSecurity.findOne({ clientId });

    if (!ssData) {
      return res.status(404).json({ success: false, error: 'Social Security data not found' });
    }

    if (!ssData.benefitAt62 || !ssData.benefitAtFra || !ssData.benefitAt70) {
      return res.status(400).json({
        success: false,
        error: 'Benefit estimates at ages 62, FRA, and 70 are required'
      });
    }

    const currentAge = moment().diff(moment(ssData.dateOfBirth), 'years');

    const analysis = SocialSecurity.calculateOptimalClaimingAge(
      {
        benefit_at_62: ssData.benefitAt62,
        benefit_at_fra: ssData.benefitAtFra,
        benefit_at_70: ssData.benefitAt70,
        full_retirement_age: ssData.fullRetirementAge
      },
      currentAge,
      parseFloat(lifeExpectancy),
      parseFloat(discountRate),
      parseFloat(inflationRate)
    );

    res.json({ success: true, data: analysis });
  } catch (error) {
    console.error('Error calculating optimal claiming age:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// CHART DATA ROUTES
// =============================================================================

const chartDataService = require('./services/chartDataService');

// Get expenses by category chart data (Admin only)
app.get('/api/admin/clients/:clientId/chart-data/expenses-by-category', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { months = 12 } = req.query;

    const data = await chartDataService.getExpensesByCategoryChart(clientId, parseInt(months));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Chart data error (expenses by category):', error);
    res.status(500).json({ success: false, error: 'Failed to generate chart data' });
  }
});

// Get income vs expenses chart data (Admin only)
app.get('/api/admin/clients/:clientId/chart-data/income-vs-expenses', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { months = 12 } = req.query;

    const data = await chartDataService.getIncomeVsExpensesChart(clientId, parseInt(months));

    res.json({ success: true, data });
  } catch (error) {
    console.error('Chart data error (income vs expenses):', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get expense breakdown chart data (Admin only)
app.get('/api/admin/clients/:clientId/chart-data/expense-breakdown', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Start date and end date are required'
      });
    }

    const data = await chartDataService.getExpenseBreakdownChart(clientId, startDate, endDate);

    res.json({ success: true, data });
  } catch (error) {
    console.error('Chart data error (expense breakdown):', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get net worth history chart data (Admin only)
app.get('/api/admin/clients/:clientId/chart-data/net-worth-history', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { months = 24, includeSocialSecurity = 'false' } = req.query;

    const data = await chartDataService.getNetWorthHistoryChart(
      clientId,
      parseInt(months),
      includeSocialSecurity === 'true'
    );

    res.json({ success: true, data });
  } catch (error) {
    console.error('Chart data error (net worth history):', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================================================
// PDF REPORT GENERATION ROUTES
// =============================================================================

const { ReportGenerator } = require('./services/pdfGenerator');
const pdfStorageService = require('./services/pdfStorageService');

// Generate PDF Report (Admin only)
app.post('/api/admin/clients/:clientId/generate-report', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { reportType, params, emailToClient = false } = req.body;

    // Validate report type
    const validTypes = ['monthly_cash_flow', 'net_worth', 'annual_summary', 'retirement_projection'];
    if (!validTypes.includes(reportType)) {
      return res.status(400).json({ success: false, error: 'Invalid report type' });
    }

    // Fetch client data
    const Client = require('./models-supabase/Client');
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    console.log(`📄 Generating ${reportType} report for client ${client.name}...`);
    const startTime = Date.now();

    // Generate PDF
    const generator = new ReportGenerator(client, reportType, params);
    const pdfBuffer = await generator.generate();

    // Determine report date for storage
    const reportDate = params.month || params.year || moment().format('YYYY-MM');

    // Upload to Supabase Storage
    const { filePath, filename } = await pdfStorageService.uploadPDF(
      pdfBuffer,
      clientId,
      reportType,
      reportDate
    );

    // Create document record in database
    const { getDatabase } = require('./database-supabase');
    const supabase = getDatabase();

    const { data: document, error: dbError } = await supabase
      .from('documents')
      .insert({
        client_id: clientId,
        filename: filename,
        file_path: filePath,
        file_type: 'pdf',
        file_size: pdfBuffer.length,
        document_category: 'generated',
        report_type: reportType,
        report_period_start: params.startDate || reportDate,
        report_period_end: params.endDate || reportDate,
        generation_params: params,
        status: 'approved' // Auto-approved since system generated
      })
      .select()
      .single();

    if (dbError) {
      console.error('Error creating document record:', dbError);
      throw dbError;
    }

    const generationTime = Date.now() - startTime;

    // Get download URL (24 hour expiry for email)
    const downloadUrl = await pdfStorageService.getSignedURL(filePath, 86400);

    // Optional: Email to client
    if (emailToClient) {
      const emailService = require('./services/emailService');
      try {
        await emailService.sendReportEmail(
          client.name,
          client.email,
          reportType,
          downloadUrl,
          24
        );
        console.log(`📧 Report emailed to ${client.email}`);
      } catch (emailError) {
        console.error('Error sending email:', emailError);
        // Don't fail the request if email fails
      }
    }

    console.log(`✅ Generated ${reportType} report for ${client.name} in ${generationTime}ms`);

    res.json({
      success: true,
      documentId: document.id,
      downloadUrl,
      generationTime,
      message: `Report generated successfully${emailToClient ? ' and emailed to client' : ''}`
    });

  } catch (error) {
    console.error('❌ Report generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download Report (Admin only)
app.get('/api/admin/reports/:documentId/download', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { documentId } = req.params;

    const { getDatabase } = require('./database-supabase');
    const supabase = getDatabase();

    const { data: document, error } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('document_category', 'generated')
      .single();

    if (error || !document) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    const signedUrl = await pdfStorageService.getSignedURL(document.file_path, 3600);

    res.json({ success: true, downloadUrl: signedUrl });

  } catch (error) {
    console.error('Error getting report download:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// List Client Reports (Client or Admin)
app.get('/api/clients/:clientId/reports', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    const clientId = req.user.clientId; // From JWT, not URL
    const { reportType, limit = 50 } = req.query;

    const { getDatabase } = require('./database-supabase');
    const supabase = getDatabase();

    let query = supabase
      .from('documents')
      .select('*')
      .eq('client_id', clientId)
      .eq('document_category', 'generated')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (reportType) {
      query = query.eq('report_type', reportType);
    }

    const { data: reports, error } = await query;

    if (error) throw error;

    res.json({ success: true, reports, count: reports.length });

  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete Report (Admin only)
app.delete('/api/admin/reports/:documentId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { documentId } = req.params;

    const { getDatabase } = require('./database-supabase');
    const supabase = getDatabase();

    // Get file path before deleting
    const { data: document } = await supabase
      .from('documents')
      .select('file_path')
      .eq('id', documentId)
      .eq('document_category', 'generated')
      .single();

    if (document && document.file_path) {
      // Delete from storage
      await pdfStorageService.deletePDF(document.file_path);
    }

    // Delete from database
    await supabase
      .from('documents')
      .delete()
      .eq('id', documentId);

    res.json({ success: true, message: 'Report deleted' });

  } catch (error) {
    console.error('Error deleting report:', error);
    res.status(500).json({ success: false, error: error.message });
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

// =============================================================================
// DOCUMENT UPLOAD & OCR ROUTES
// =============================================================================

// Create document record after file upload to Supabase Storage
app.post('/api/clients/:clientId/upload-statement', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { filename, filePath, fileType, fileSize, accountType, statementDate, notes } = req.body;

    // Validate required fields
    if (!filename || !filePath || !fileType || !fileSize || !accountType || !statementDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create document record in Supabase
    const { data, error } = await supabase
      .from('documents')
      .insert({
        client_id: clientId,
        filename,
        file_path: filePath,
        file_type: fileType,
        file_size: fileSize,
        account_type: accountType,
        statement_date: statementDate,
        notes,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating document record:', error);
      return res.status(500).json({ error: 'Failed to create document record' });
    }

    logSecurityEvent('document_uploaded', clientId, req.ip, {
      documentId: data.id,
      filename,
      accountType
    });

    res.json({
      success: true,
      document: data
    });
  } catch (error) {
    console.error('Upload statement error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all statements for a client
app.get('/api/clients/:clientId/statements', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    const clientId = req.user.clientId;

    // Use getDatabase() to ensure proper Supabase client initialization
    const { getDatabase } = require('./database-supabase');
    const supabaseClient = getDatabase();

    // Get documents from Supabase
    const { data, error } = await supabaseClient
      .from('documents')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching documents:', error);
      return res.status(500).json({ 
        success: false,
        error: 'Failed to fetch documents',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }

    res.json({
      success: true,
      documents: data || []
    });
  } catch (error) {
    console.error('Get statements error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Process OCR for a document (Admin only)
app.post('/api/admin/statements/:documentId/process-ocr', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { documentId } = req.params;

    // Get document from Supabase
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (fetchError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Update status to processing
    const { error: updateError } = await supabase
      .from('documents')
      .update({ status: 'processing' })
      .eq('id', documentId);

    if (updateError) {
      console.error('Error updating document status:', updateError);
      return res.status(500).json({ error: 'Failed to update document status' });
    }

    // Call Python OCR script or use OCR service
    // For now, we'll simulate OCR processing
    // In production, you would call your Python script like this:
    /*
    const { spawn } = require('child_process');
    const pythonProcess = spawn('python3', ['scripts/ocr_processor.py', document.file_path]);

    let ocrDataBuffer = '';
    pythonProcess.stdout.on('data', (data) => {
      ocrDataBuffer += data.toString();
    });

    pythonProcess.on('close', async (code) => {
      if (code === 0) {
        const ocrData = JSON.parse(ocrDataBuffer);
        // Update document with OCR data
        const { error: updateError } = await supabase
          .from('documents')
          .update({
            ocr_data: ocrData,
            status: 'processed',
            processed_at: new Date().toISOString(),
            processed_by: req.user.clientId
          })
          .eq('id', documentId);

        if (!updateError && ocrData.transactions && ocrData.transactions.length > 0) {
          // Automatically extract transactions from OCR data
          // This will be handled by calling the extract-transactions endpoint
          // or you can call the extraction logic directly here
        }
      }
    });
    */
    
    // Note: After OCR processing completes and ocr_data is saved,
    // you should call POST /api/admin/statements/:documentId/extract-transactions
    // to automatically extract and save transactions to the database

    logSecurityEvent('ocr_processing_started', req.user.clientId, req.ip, {
      documentId,
      filename: document.filename
    });

    res.json({
      success: true,
      message: 'OCR processing started',
      documentId
    });
  } catch (error) {
    console.error('Process OCR error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update OCR data for a document (Admin only - for manual corrections)
app.put('/api/admin/statements/:documentId/ocr-data', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { ocrData } = req.body;

    if (!ocrData) {
      return res.status(400).json({ error: 'OCR data is required' });
    }

    // Update document with new OCR data
    const { data, error } = await supabase
      .from('documents')
      .update({
        ocr_data: ocrData,
        processed_at: new Date().toISOString(),
        processed_by: req.user.clientId
      })
      .eq('id', documentId)
      .select()
      .single();

    if (error) {
      console.error('Error updating OCR data:', error);
      return res.status(500).json({ error: 'Failed to update OCR data' });
    }

    logSecurityEvent('ocr_data_updated', req.user.clientId, req.ip, {
      documentId
    });

    res.json({
      success: true,
      document: data
    });
  } catch (error) {
    console.error('Update OCR data error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Approve and import OCR data into balance sheets (Admin only)
app.post('/api/admin/statements/:documentId/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { documentId } = req.params;

    // Get document with OCR data
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (fetchError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (!document.ocr_data) {
      return res.status(400).json({ error: 'No OCR data available for this document' });
    }

    // Extract account data from OCR
    const ocrData = document.ocr_data;
    const balanceSheetEntries = [];

    // Process each account found in OCR data
    if (ocrData.accounts && Array.isArray(ocrData.accounts)) {
      for (const account of ocrData.accounts) {
        const balanceSheet = {
          clientId: document.client_id,
          date: account.asOfDate || document.statement_date,
          accountName: account.accountName,
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          balance: account.balance,
          currency: account.currency || 'USD',
          source: 'document_upload',
          metadata: {
            documentId: document.id,
            filename: document.filename,
            extractedDate: ocrData.extractedDate,
            confidence: ocrData.confidence
          }
        };

        // Insert into balance_sheets collection
        const { data: inserted, error: insertError } = await supabase
          .from('balance_sheets')
          .insert(balanceSheet)
          .select()
          .single();

        if (!insertError && inserted) {
          balanceSheetEntries.push(inserted);
        }
      }
    }

    // Update document status to approved
    const { error: updateError } = await supabase
      .from('documents')
      .update({
        status: 'approved',
        processed_at: new Date().toISOString(),
        processed_by: req.user.clientId
      })
      .eq('id', documentId);

    if (updateError) {
      console.error('Error updating document status:', updateError);
      return res.status(500).json({ error: 'Failed to update document status' });
    }

    logSecurityEvent('document_approved', req.user.clientId, req.ip, {
      documentId,
      balanceSheetEntriesCreated: balanceSheetEntries.length
    });

    res.json({
      success: true,
      message: 'Document approved and data imported',
      balanceSheetEntries
    });
  } catch (error) {
    console.error('Approve document error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Extract transactions from OCR data and save to database
app.post('/api/admin/statements/:documentId/extract-transactions', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { documentId } = req.params;

    // Get document with OCR data
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (fetchError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (!document.ocr_data) {
      return res.status(400).json({ error: 'No OCR data available for this document. Please process OCR first.' });
    }

    const ocrData = document.ocr_data;
    const clientId = document.client_id;
    const transactionsCreated = [];
    const transactionsUpdated = [];
    const errors = [];

    // Extract transactions from OCR data
    // Expected OCR data structure:
    // {
    //   transactions: [
    //     {
    //       date: "2026-01-15",
    //       amount: -45.50,
    //       description: "AMAZON.COM",
    //       merchant: "Amazon",
    //       category: ["Food and Drink", "Groceries"],
    //       accountName: "Chase Checking",
    //       accountType: "depository"
    //     }
    //   ]
    // }

    if (!ocrData.transactions || !Array.isArray(ocrData.transactions)) {
      return res.status(400).json({ 
        error: 'No transactions found in OCR data. Expected ocrData.transactions to be an array.' 
      });
    }

    // Process each transaction
    for (const ocrTransaction of ocrData.transactions) {
      try {
        // Parse date
        const transactionDate = ocrTransaction.date ? new Date(ocrTransaction.date) : new Date(document.statement_date);
        const monthYear = moment(transactionDate).format('YYYY-MM');

        // Determine account type from document or OCR data
        const accountType = ocrTransaction.accountType || document.account_type || null;
        const accountName = ocrTransaction.accountName || null;
        const accountId = ocrTransaction.accountId || null;

        // Create a unique transaction ID based on date, amount, and description
        // This helps prevent duplicates
        const transactionId = `${clientId}_${transactionDate.toISOString()}_${ocrTransaction.amount}_${ocrTransaction.description?.substring(0, 20) || ''}`;

        // Categorize transaction using TransactionProcessor
        const TransactionProcessor = require('./services/transactionProcessor');
        const categorized = TransactionProcessor.categorizeTransaction({
          amount: ocrTransaction.amount,
          name: ocrTransaction.description || ocrTransaction.name || '',
          merchant_name: ocrTransaction.merchant,
          category: ocrTransaction.category || []
        }, accountType);

        // Prepare transaction data
        const transactionData = {
          clientId: clientId,
          plaidTransactionId: transactionId, // Use custom ID since not from Plaid
          accountId: accountId,
          accountType: accountType,
          accountSubtype: ocrTransaction.accountSubtype || null,
          accountName: accountName,
          accountMask: ocrTransaction.accountMask || null,
          amount: parseFloat(ocrTransaction.amount) || 0,
          date: transactionDate,
          name: ocrTransaction.description || ocrTransaction.name || 'Unknown',
          merchantName: ocrTransaction.merchant || null,
          category: ocrTransaction.category || [],
          plaidCategory: ocrTransaction.category?.[0] || null,
          plaidSubCategory: ocrTransaction.category?.[1] || null,
          personalFinanceCategory: null, // Not available from OCR
          suggestedCategory: categorized.subCategory,
          userCategory: null,
          isReviewed: false, // Transactions from OCR need review
          monthYear: monthYear,
          notes: `Extracted from statement: ${document.filename}`,
          institution: ocrTransaction.institution || document.account_type || 'Statement Upload'
        };

        // Use findOneAndUpdate with upsert to avoid duplicates
        const existing = await Transaction.findOne({ 
          clientId: clientId,
          plaidTransactionId: transactionId 
        });

        if (existing) {
          // Update existing transaction
          await Transaction.update(existing.id, {
            userCategory: transactionData.userCategory,
            isReviewed: transactionData.isReviewed,
            notes: transactionData.notes
          });
          transactionsUpdated.push(transactionData);
        } else {
          // Create new transaction
          await Transaction.create(transactionData);
          transactionsCreated.push(transactionData);
        }

      } catch (error) {
        console.error(`Error processing transaction from OCR:`, error);
        errors.push({
          transaction: ocrTransaction,
          error: error.message
        });
      }
    }

    // Update document status if transactions were successfully extracted
    if (transactionsCreated.length > 0 || transactionsUpdated.length > 0) {
      const { error: updateError } = await supabase
        .from('documents')
        .update({
          status: 'processed',
          processed_at: new Date().toISOString(),
          processed_by: req.user.clientId
        })
        .eq('id', documentId);

      if (updateError) {
        console.error('Error updating document status:', updateError);
      }
    }

    logSecurityEvent('transactions_extracted_from_ocr', req.user.clientId, req.ip, {
      documentId,
      transactionsCreated: transactionsCreated.length,
      transactionsUpdated: transactionsUpdated.length,
      errors: errors.length
    });

    res.json({
      success: true,
      message: `Extracted ${transactionsCreated.length} new transactions and updated ${transactionsUpdated.length} existing transactions`,
      transactionsCreated: transactionsCreated.length,
      transactionsUpdated: transactionsUpdated.length,
      errors: errors.length,
      errorDetails: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('Extract transactions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Reject a document (Admin only)
app.post('/api/admin/statements/:documentId/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    // Update document status to rejected
    const { data, error } = await supabase
      .from('documents')
      .update({
        status: 'rejected',
        rejected_reason: reason,
        processed_at: new Date().toISOString(),
        processed_by: req.user.clientId
      })
      .eq('id', documentId)
      .select()
      .single();

    if (error) {
      console.error('Error rejecting document:', error);
      return res.status(500).json({ error: 'Failed to reject document' });
    }

    logSecurityEvent('document_rejected', req.user.clientId, req.ip, {
      documentId,
      reason
    });

    res.json({
      success: true,
      message: 'Document rejected',
      document: data
    });
  } catch (error) {
    console.error('Reject document error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// PLAID ROUTES
// =============================================================================

// Plaid routes
// Plaid endpoint disabled - using statement upload + OCR instead
app.post('/api/create_link_token', requireAuth, plaidLimiter, async (req, res) => {
  res.status(404).json({ 
    error: 'Plaid integration has been removed. Please upload account statements instead.' 
  });
});

// Plaid endpoint disabled - using statement upload + OCR instead
app.post('/api/exchange_public_token', requireAuth, plaidLimiter, async (req, res) => {
  res.status(404).json({ 
    error: 'Plaid integration has been removed. Please upload account statements instead.' 
  });
});

// Add Plaid token to client
// Plaid endpoint disabled - using statement upload + OCR instead
app.post('/api/clients/:clientId/plaid-token', requireAuth, ensureClientOwnership, async (req, res) => {
  res.status(404).json({ 
    error: 'Plaid integration has been removed. Please upload account statements instead.' 
  });
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
      database_status: 'connected (Supabase/PostgreSQL)'
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
    
    // MonthlySummary.find() already orders by date descending
    const allSummaries = await MonthlySummary.find({ clientId });
    
    // Apply limit manually (MonthlySummary.find doesn't support limit parameter yet)
    const summaries = allSummaries.slice(0, parseInt(limit));
    
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
  // Handle undefined or null investments
  if (!investments || !Array.isArray(investments)) {
    return {
      totalValue: 0,
      totalByTaxType: {
        'tax-free': 0,
        'tax-deferred': 0,
        'taxable': 0
      },
      holdingsByAccount: [],
      holdingsBySecurity: []
    };
  }
  
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
  console.log(`💾 Database: ✅ Supabase/PostgreSQL`);
  console.log(`🔗 Supabase URL: ${process.env.SUPABASE_URL ? '✅ Found' : '❌ Missing'}`);
  console.log(`🔑 Supabase Key: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Found' : '❌ Missing'}`);

  // Log available models
  console.log(`📊 Transaction Model: ${Transaction ? '✅ Available' : '⚠️  Not available - using legacy mode'}`);
  console.log(`📈 MonthlySummary Model: ${MonthlySummary ? '✅ Available' : '❌ Missing'}`);
  console.log(`👤 Client Model: ${Client ? '✅ Available' : '❌ Missing'}`);
});