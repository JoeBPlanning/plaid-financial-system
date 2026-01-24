const { createPlaidClient } = require('../utils/plaidConfig');
const Client = require('../models-supabase/Client');
const Transaction = require('../models-supabase/Transaction');
const TransactionProcessor = require('./transactionProcessor');
const moment = require('moment');

// Initialize Plaid client
const plaidClient = createPlaidClient();

// Helper function to sleep (for polling)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sync transactions for a specific client using transactionsSync API
 * This follows the quickstart pattern for transactionsSync
 * 
 * @param {string} clientId - The client ID
 * @param {string} itemId - Optional: specific item ID to sync. If not provided, syncs all items
 * @returns {Promise<Object>} - Summary of sync results
 */
async function syncTransactionsForClient(clientId, itemId = null) {
  try {
    console.log(`🔄 Starting transaction sync for client: ${clientId}`);
    
    const client = await Client.findOne({ clientId });
    if (!client) {
      throw new Error('Client not found');
    }

    const results = {
      clientId,
      itemsProcessed: 0,
      transactionsAdded: 0,
      transactionsModified: 0,
      transactionsRemoved: 0,
      errors: []
    };

    // Process each Plaid connection
    for (const plaidConnection of client.plaidAccessTokens || []) {
      // Skip if not active
      if (!plaidConnection.isActive) {
        continue;
      }

      // If itemId is specified, only process that item
      if (itemId && plaidConnection.itemId !== itemId) {
        continue;
      }

      // Skip test/fake access tokens
      if (plaidConnection.accessToken === 'access-sandbox-test-token' || 
          plaidConnection.accessToken.startsWith('test-') ||
          plaidConnection.accessToken.includes('fake')) {
        console.log(`⚠️  Skipping test connection: ${plaidConnection.institutionName}`);
        continue;
      }

      try {
        const itemResult = await syncTransactionsForItem(
          clientId,
          plaidConnection,
          client
        );

        results.itemsProcessed++;
        results.transactionsAdded += itemResult.added;
        results.transactionsModified += itemResult.modified;
        results.transactionsRemoved += itemResult.removed;

        // Update cursor in client document - only after successful sync
        // The cursor represents the point we've successfully synced up to
        // According to Plaid docs: cursor should be saved after ALL pages are processed
        const connectionIndex = client.plaidAccessTokens.findIndex(
          conn => conn.itemId === plaidConnection.itemId
        );
        if (connectionIndex !== -1) {
          // Store the cursor - this will be used for the next sync
          // Empty string means no more updates available, null means first sync
          client.plaidAccessTokens[connectionIndex].transactionCursor = itemResult.cursor || "";
        }

      } catch (error) {
        console.error(`❌ Error syncing ${plaidConnection.institutionName}:`, error.message);
        results.errors.push({
          institution: plaidConnection.institutionName,
          error: error.message
        });
      }
    }

    // Save updated cursors
    await client.save();

    console.log(`✅ Sync complete for ${clientId}:`);
    console.log(`   Items processed: ${results.itemsProcessed}`);
    console.log(`   Added: ${results.transactionsAdded}`);
    console.log(`   Modified: ${results.transactionsModified}`);
    console.log(`   Removed: ${results.transactionsRemoved}`);

    return results;

  } catch (error) {
    console.error('❌ Error in syncTransactionsForClient:', error);
    throw error;
  }
}

/**
 * Sync transactions for a specific Plaid item/connection
 * This implements the transactionsSync pattern following Plaid best practices:
 * - Retrieve ALL available updates before persisting to database
 * - Handle TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION errors by restarting
 * - Only save cursor after successfully processing all pages
 * 
 * @param {string} clientId - The client ID
 * @param {Object} plaidConnection - The Plaid connection object from Client model
 * @param {Object} client - The Client document (for account type mapping)
 * @returns {Promise<Object>} - Sync results for this item
 */
async function syncTransactionsForItem(clientId, plaidConnection, client) {
  // Get current cursor (or null for first sync, or "" for empty cursor)
  // Use stored cursor, or null if not set (null = first sync, "" = no data available)
  let cursor = plaidConnection.transactionCursor || null;
  
  // If cursor is explicitly set to empty string, convert to null for first sync
  if (cursor === "") {
    cursor = null;
  }

  // Arrays to collect all changes - must retrieve ALL before persisting
  let added = [];
  let modified = [];
  let removed = [];
  let hasMore = true;
  let maxRetries = 3;
  let retryCount = 0;
  const initialCursor = cursor; // Store initial cursor for retry logic

  // Get account types, subtypes, names, and masks for categorization
  let accountTypeMap = {};
  let accountSubtypeMap = {};
  let accountNameMap = {};
  let accountMaskMap = {};
  try {
    const accountsResponse = await plaidClient.accountsGet({
      access_token: plaidConnection.accessToken
    });
    accountsResponse.data.accounts.forEach(account => {
      accountTypeMap[account.account_id] = account.type;
      accountSubtypeMap[account.account_id] = account.subtype;
      
      // Create human-readable account name
      const typeLabel = account.type === 'credit' ? 'Credit Card' : 
                       account.type === 'depository' ? (account.subtype === 'checking' ? 'Checking' : account.subtype === 'savings' ? 'Savings' : 'Depository') :
                       account.type === 'loan' ? 'Loan' :
                       account.type === 'investment' ? 'Investment' : account.type;
      
      accountNameMap[account.account_id] = account.name || `${typeLabel} ${account.mask ? `****${account.mask}` : ''}`.trim();
      accountMaskMap[account.account_id] = account.mask || null;
    });
  } catch (error) {
    console.error('Error fetching accounts for type mapping:', error.message);
  }

  // Iterate through each page of transaction updates
  // According to Plaid docs: retrieve ALL available updates before persisting
  while (hasMore) {
    try {
      const request = {
        access_token: plaidConnection.accessToken,
        cursor: cursor,
      };

      const response = await plaidClient.transactionsSync(request);
      const data = response.data;

      // Update cursor
      cursor = data.next_cursor;

      // If cursor is empty string, no transactions are available yet
      // Wait and poll (in production, you'd use webhooks instead)
      if (cursor === "") {
        await sleep(2000);
        continue;
      }

      // Add this page of results
      added = added.concat(data.added || []);
      modified = modified.concat(data.modified || []);
      removed = removed.concat(data.removed || []);

      hasMore = data.has_more;

      console.log(`   📄 Page: ${added.length} added, ${modified.length} modified, ${removed.length} removed`);

      // Reset retry count on successful page
      retryCount = 0;

    } catch (error) {
      // Handle TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION error
      // According to docs: must restart from beginning (first cursor)
      if (error.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' || 
          (error.response && error.response.data && error.response.data.error_code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')) {
        
        if (retryCount < maxRetries) {
          retryCount++;
          console.log(`   ⚠️  TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION detected. Restarting from beginning (attempt ${retryCount}/${maxRetries})...`);
          
          // Reset to initial cursor and clear collected data
          cursor = initialCursor;
          added = [];
          modified = [];
          removed = [];
          hasMore = true;
          
          // Wait a bit before retrying
          await sleep(1000 * retryCount);
          continue;
        } else {
          throw new Error('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION: Max retries exceeded. Please try again later.');
        }
      } else {
        // Other errors - throw immediately
        throw error;
      }
    }
  }

  // Process added transactions
  let addedCount = 0;
  for (const transaction of added) {
    try {
      const accountType = accountTypeMap[transaction.account_id] || null;
      const categorized = TransactionProcessor.categorizeTransaction(transaction, accountType);
      
      const monthYear = moment(transaction.date).format('YYYY-MM');

      const accountId = transaction.account_id;
      const transactionDoc = {
        _id: transaction.transaction_id,
        plaidTransactionId: transaction.transaction_id,
        clientId,
        accountId: accountId,
        accountType: accountTypeMap[accountId] || null,
        accountSubtype: accountSubtypeMap[accountId] || null,
        accountName: accountNameMap[accountId] || null,
        accountMask: accountMaskMap[accountId] || null,
        name: transaction.name,
        merchantName: transaction.merchant_name || null,
        amount: transaction.amount,
        date: new Date(transaction.date),
        category: transaction.category || [],
        plaidCategory: transaction.category?.[0] || null,
        plaidSubCategory: transaction.category?.[1] || null,
        personalFinanceCategory: transaction.personal_finance_category ? {
          primary: transaction.personal_finance_category.primary,
          detailed: transaction.personal_finance_category.detailed,
          confidence: transaction.personal_finance_category.confidence
        } : null,
        suggestedCategory: categorized.subCategory,
        userCategory: null,
        isReviewed: false,
        monthYear,
        institution: plaidConnection.institutionName,
        notes: null
      };

      // Use upsert based on plaidTransactionId - this is the authoritative ID from Plaid
      // The cursor-based sync system ensures we don't get duplicates if used correctly
      await Transaction.findOneAndUpdate(
        { plaidTransactionId: transaction.transaction_id },
        transactionDoc,
        { upsert: true, new: true }
      );

      addedCount++;
    } catch (error) {
      console.error(`Error saving added transaction ${transaction.transaction_id}:`, error.message);
    }
  }

  // Process modified transactions
  let modifiedCount = 0;
  for (const transaction of modified) {
    try {
      const accountType = accountTypeMap[transaction.account_id] || null;
      const categorized = TransactionProcessor.categorizeTransaction(transaction, accountType);
      
      const monthYear = moment(transaction.date).format('YYYY-MM');

      const accountId = transaction.account_id;
      const updateDoc = {
        name: transaction.name,
        merchantName: transaction.merchant_name || null,
        amount: transaction.amount,
        date: new Date(transaction.date),
        accountType: accountTypeMap[accountId] || null,
        accountSubtype: accountSubtypeMap[accountId] || null,
        accountName: accountNameMap[accountId] || null,
        accountMask: accountMaskMap[accountId] || null,
        category: transaction.category || [],
        plaidCategory: transaction.category?.[0] || null,
        plaidSubCategory: transaction.category?.[1] || null,
        personalFinanceCategory: transaction.personal_finance_category ? {
          primary: transaction.personal_finance_category.primary,
          detailed: transaction.personal_finance_category.detailed,
          confidence: transaction.personal_finance_category.confidence
        } : null,
        suggestedCategory: categorized.subCategory,
        monthYear,
        institution: plaidConnection.institutionName
      };

      await Transaction.findOneAndUpdate(
        { plaidTransactionId: transaction.transaction_id },
        updateDoc,
        { new: true }
      );

      modifiedCount++;
    } catch (error) {
      console.error(`Error updating modified transaction ${transaction.transaction_id}:`, error.message);
    }
  }

  // Process removed transactions
  let removedCount = 0;
  for (const removedTx of removed) {
    try {
      await Transaction.deleteOne({ 
        plaidTransactionId: removedTx.transaction_id,
        clientId 
      });
      removedCount++;
    } catch (error) {
      console.error(`Error removing transaction ${removedTx.transaction_id}:`, error.message);
    }
  }

  // Return the final cursor - this should be saved AFTER all processing is complete
  // The cursor represents the point in time we've successfully synced up to
  return {
    cursor: cursor || "", // Use empty string if cursor is null (no more updates)
    added: addedCount,
    modified: modifiedCount,
    removed: removedCount
  };
}

/**
 * Get transactions for a client from the database
 * This is the preferred method after using transactionsSync
 * 
 * @param {string} clientId - The client ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} - Array of transactions
 */
async function getTransactionsFromDatabase(clientId, options = {}) {
  const {
    month = null,
    months = null,
    limit = 100,
    startDate = null,
    endDate = null
  } = options;

  const query = { clientId };

  // If months parameter is provided, fetch last N months
  if (months) {
    const numMonths = parseInt(months);
    const monthList = [];
    for (let i = 0; i < numMonths; i++) {
      monthList.push(moment().subtract(i, 'months').format('YYYY-MM'));
    }
    query.monthYear = { $in: monthList };
  } else if (month) {
    query.monthYear = month;
  }

  // Date range filtering
  if (startDate || endDate) {
    query.date = {};
    if (startDate) {
      query.date.$gte = new Date(startDate);
    }
    if (endDate) {
      query.date.$lte = new Date(endDate);
    }
  }

  const transactions = await Transaction.find(query, { limit: parseInt(limit) });

  return transactions;
}

module.exports = {
  syncTransactionsForClient,
  syncTransactionsForItem,
  getTransactionsFromDatabase
};

