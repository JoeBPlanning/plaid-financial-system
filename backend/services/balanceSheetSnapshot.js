const moment = require('moment');
const Client = require('../models-supabase/Client');
const BalanceSheet = require('../models-supabase/BalanceSheet');
const TransactionProcessor = require('./transactionProcessor');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

// Initialize Plaid client
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

/**
 * Get current account balances from Plaid for a client
 * Returns net worth breakdown
 */
async function getCurrentAccountBalances(client) {
  const netWorth = {
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
  };

  if (!client.plaidAccessTokens || client.plaidAccessTokens.length === 0) {
    return netWorth;
  }

  // Fetch balances from all Plaid connections
  for (const tokenData of client.plaidAccessTokens) {
    if (!tokenData.isActive || !tokenData.accessToken) {
      continue;
    }

    try {
      // Get accounts with balances
      const accountsResponse = await plaidClient.accountsBalanceGet({
        access_token: tokenData.accessToken
      });

      const accounts = accountsResponse.data.accounts || [];

      for (const account of accounts) {
        const balance = account.balances.current || 0;
        const accountType = account.type;
        const accountSubtype = account.subtype || '';

        if (accountType === 'depository') {
          // Assets
          netWorth.assets += balance;
          
          if (accountSubtype === 'checking') {
            netWorth.assetBreakdown.checking += balance;
          } else if (accountSubtype === 'savings') {
            netWorth.assetBreakdown.savings += balance;
          }
        } else if (accountType === 'investment') {
          // Investment accounts are assets
          netWorth.assets += balance;
          netWorth.assetBreakdown.investments += balance;
        } else if (accountType === 'credit') {
          // Liabilities (credit card debt)
          netWorth.liabilities += Math.abs(balance);
          netWorth.liabilityBreakdown.creditCards += Math.abs(balance);
        } else if (accountType === 'loan') {
          // Liabilities
          netWorth.liabilities += Math.abs(balance);
          
          if (accountSubtype === 'student' || accountSubtype === 'student loan') {
            netWorth.liabilityBreakdown.studentLoans += Math.abs(balance);
          } else if (accountSubtype === 'mortgage') {
            netWorth.liabilityBreakdown.mortgage += Math.abs(balance);
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching balances for item ${tokenData.itemId}:`, error.message);
      // Continue with other accounts
    }
  }

  // Calculate totals
  netWorth.assetBreakdown.total = 
    netWorth.assetBreakdown.checking +
    netWorth.assetBreakdown.savings +
    netWorth.assetBreakdown.investments +
    netWorth.assetBreakdown.realEstate;

  netWorth.liabilityBreakdown.total = 
    netWorth.liabilityBreakdown.creditCards +
    netWorth.liabilityBreakdown.studentLoans +
    netWorth.liabilityBreakdown.mortgage;

  netWorth.netWorth = netWorth.assets - netWorth.liabilities;

  return netWorth;
}

/**
 * Capture a balance sheet snapshot for a client
 * @param {string} clientId - Client ID
 * @param {string} snapshotDate - Date string (YYYY-MM-DD) or Date object. Defaults to today
 * @returns {Object} - Created balance sheet snapshot
 */
async function captureBalanceSheetSnapshot(clientId, snapshotDate = null) {
  try {
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }

    // Use provided date or today
    const date = snapshotDate 
      ? moment(snapshotDate).format('YYYY-MM-DD')
      : moment().format('YYYY-MM-DD');
    
    const monthYear = moment(date).format('YYYY-MM');

    // Check if snapshot already exists for this date
    const existing = await BalanceSheet.findOne({ 
      clientId, 
      snapshotDate: date 
    });

    if (existing) {
      console.log(`Balance sheet snapshot already exists for ${clientId} on ${date}`);
      return existing;
    }

    // Get current account balances
    const netWorth = await getCurrentAccountBalances(client);

    // Create balance sheet snapshot
    const balanceSheet = await BalanceSheet.create({
      clientId,
      snapshotDate: date,
      monthYear,
      assets: netWorth.assets,
      liabilities: netWorth.liabilities,
      netWorth: netWorth.netWorth,
      assetBreakdown: netWorth.assetBreakdown,
      liabilityBreakdown: netWorth.liabilityBreakdown
    });

    console.log(`✅ Captured balance sheet snapshot for ${clientId} on ${date}`);
    console.log(`   Assets: $${netWorth.assets.toFixed(2)}`);
    console.log(`   Liabilities: $${netWorth.liabilities.toFixed(2)}`);
    console.log(`   Net Worth: $${netWorth.netWorth.toFixed(2)}`);

    return balanceSheet;
  } catch (error) {
    console.error(`Error capturing balance sheet snapshot for ${clientId}:`, error);
    throw error;
  }
}

/**
 * Capture balance sheet snapshots for all active clients
 * Useful for scheduled jobs
 */
async function captureAllClientsSnapshots(snapshotDate = null) {
  try {
    const clients = await Client.find({ isActive: true });
    
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const client of clients) {
      try {
        await captureBalanceSheetSnapshot(client.clientId, snapshotDate);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          clientId: client.clientId,
          error: error.message
        });
        console.error(`Failed to capture snapshot for ${client.clientId}:`, error.message);
      }
    }

    console.log(`\n📊 Balance Sheet Snapshot Summary:`);
    console.log(`   Success: ${results.success}`);
    console.log(`   Failed: ${results.failed}`);

    return results;
  } catch (error) {
    console.error('Error capturing snapshots for all clients:', error);
    throw error;
  }
}

/**
 * Capture snapshot on the 5th of the month for a specific client
 * This should be called by a scheduled job
 */
async function captureMonthlySnapshot(clientId) {
  const today = moment();
  
  // Only capture on the 5th of the month
  if (today.date() !== 5) {
    console.log(`Not the 5th of the month. Skipping snapshot for ${clientId}`);
    return null;
  }

  const snapshotDate = today.format('YYYY-MM-DD');
  return await captureBalanceSheetSnapshot(clientId, snapshotDate);
}

module.exports = {
  captureBalanceSheetSnapshot,
  captureAllClientsSnapshots,
  captureMonthlySnapshot,
  getCurrentAccountBalances
};

