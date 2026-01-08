const express = require('express');
const router = express.Router();
const Client = require('../models-supabase/Client');
const MonthlySummary = require('../models-supabase/MonthlySummary');
const Transaction = require('../models-supabase/Transaction');
const TransactionProcessor = require('../services/transactionProcessor');
const moment = require('moment');
const { requireAuth, ensureClientOwnership } = require('../middleware/auth');

// Create a new client (requires authentication)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, email, advisorId } = req.body;
    
    if (!name || !email || !advisorId) {
      return res.status(400).json({ 
        error: 'Name, email, and advisorId are required' 
      });
    }

    // Generate unique client ID
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const client = await Client.create({
      clientId,
      name,
      email,
      advisorId
    });
    
    res.json({
      success: true,
      client: {
        clientId: client.clientId,
        name: client.name,
        email: client.email,
        advisorId: client.advisorId
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Get all clients for an advisor (requires authentication)
router.get('/advisor/:advisorId', requireAuth, async (req, res) => {
  try {
    const { advisorId } = req.params;
    
    const clients = await Client.find({ 
      advisorId, 
      isActive: true 
    });
    
    // Remove sensitive access tokens from response
    const safeClients = clients.map(client => {
      const { plaidAccessTokens, ...safeClient } = client.toObject ? client.toObject() : client;
      if (plaidAccessTokens) {
        safeClient.plaidAccessTokens = plaidAccessTokens.map(token => {
          const { accessToken, ...safeToken } = token;
          return safeToken; // Return token without accessToken field
        });
      }
      return safeClient;
    });
    
    res.json({ clients: safeClients });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific client (protected route)
router.get('/:clientId', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    // Remove sensitive access tokens from response
    const { plaidAccessTokens, ...safeClient } = client.toObject ? client.toObject() : client;
    if (plaidAccessTokens) {
      safeClient.plaidAccessTokens = plaidAccessTokens.map(token => {
        const { accessToken, ...safeToken } = token;
        return safeToken; // Return token without accessToken field
      });
    }
    
    res.json({ client: safeClient });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add Plaid access token to client (protected route)
router.post('/:clientId/plaid-token', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { accessToken, itemId, institutionName, institutionId, accountIds } = req.body;
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Add new Plaid connection
    client.plaidAccessTokens.push({
      accessToken,
      itemId,
      institutionName,
      institutionId,
      accountIds
    });

    await client.save();
    
    res.json({ 
      success: true, 
      message: 'Bank account connected successfully',
      institutionName 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get client's monthly summaries (protected route)
router.get('/:clientId/summaries', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { year, limit = 12 } = req.query;
    
    let query = { clientId };
    if (year) {
      query.year = parseInt(year);
    }
    
    const summaries = await MonthlySummary.find(query)
      .sort({ year: -1, month: -1 })
      .limit(parseInt(limit));
    
    res.json({ summaries });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get specific monthly summary (protected route)
router.get('/:clientId/summary/:month', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { month } = req.params;
    
    const summary = await MonthlySummary.findOne({ clientId, month });
    
    if (!summary) {
      return res.status(404).json({ error: 'Summary not found for this month' });
    }
    
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update monthly summary (protected route)
router.post('/:clientId/summary', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const summaryData = req.body;
    
    // Extract month and year from the data
    const { month, year } = summaryData;
    
    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    const summary = await MonthlySummary.findOneAndUpdate(
      { clientId, month },
      { ...summaryData, clientId },
      { upsert: true, new: true }
    );
    
    res.json({ 
      success: true, 
      summary,
      message: 'Monthly summary saved successfully' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== NEW TRANSACTION REVIEW ROUTES =====

// Note: The store-transactions route is defined in server.js to avoid conflicts
// and to have access to the Plaid client and fetchTransactionsFromPlaid function

// Get transactions for review (protected route)
router.get('/:clientId/transactions/uncategorized', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { monthYear } = req.query;
    
    const transactions = await TransactionProcessor.getTransactionsForReview(clientId, monthYear);
    
    res.json({
      success: true,
      transactions: transactions.map(t => ({
        id: t._id.toString(),
        name: t.name,
        merchant_name: t.merchantName,
        amount: t.amount,
        date: t.date.toISOString().split('T')[0],
        category: t.category,
        plaidCategory: t.plaidCategory,
        suggestedCategory: t.suggestedCategory,
        userCategory: t.userCategory,
        isReviewed: t.isReviewed
      }))
    });
  } catch (error) {
    console.error('Error getting transactions for review:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update transaction category (protected route)
router.put('/:clientId/transactions/:transactionId/category', requireAuth, ensureClientOwnership, async (req, res) => {
  try {
    // Derive clientId exclusively from authenticated JWT
    const clientId = req.user.clientId;
    const { transactionId } = req.params;
    const { category } = req.body;
    
    const transaction = await TransactionProcessor.updateTransactionCategory(clientId, transactionId, category);
    
    res.json({
      success: true,
      transaction: {
        id: transaction._id.toString(),
        userCategory: transaction.userCategory,
        isReviewed: transaction.isReviewed
      }
    });
  } catch (error) {
    console.error('Error updating transaction category:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;