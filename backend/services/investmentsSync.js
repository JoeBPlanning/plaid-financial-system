const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const Client = require('../models-sqlite/Client');
const Investment = require('../models-sqlite/Investment');

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
 * Determine account tax type based on account subtype and name
 * @param {string} accountSubtype - Account subtype from Plaid
 * @param {string} accountName - Account name
 * @returns {string} - 'tax-free', 'tax-deferred', or 'taxable'
 */
function determineAccountTaxType(accountSubtype, accountName = '') {
  const name = accountName.toLowerCase();
  const subtype = (accountSubtype || '').toLowerCase();
  
  // Tax-free accounts (Roth IRA, HSA, etc.)
  if (subtype.includes('roth') || name.includes('roth')) {
    return 'tax-free';
  }
  if (subtype.includes('hsa') || name.includes('hsa')) {
    return 'tax-free';
  }
  
  // Tax-deferred accounts (401k, Traditional IRA, etc.)
  if (subtype.includes('401k') || name.includes('401k') || name.includes('401(k)')) {
    return 'tax-deferred';
  }
  if (subtype.includes('ira') || name.includes('ira')) {
    // Traditional IRA is tax-deferred, Roth IRA is tax-free (already handled above)
    if (!name.includes('roth')) {
      return 'tax-deferred';
    }
  }
  if (subtype.includes('403b') || name.includes('403b') || name.includes('403(b)')) {
    return 'tax-deferred';
  }
  if (subtype.includes('457') || name.includes('457')) {
    return 'tax-deferred';
  }
  if (subtype.includes('pension') || name.includes('pension')) {
    return 'tax-deferred';
  }
  
  // Default to taxable
  return 'taxable';
}

/**
 * Fetch investment holdings from Plaid for a specific access token
 */
async function fetchInvestmentsFromPlaid(accessToken, itemId, institutionName, institutionId) {
  try {
    // First, get accounts to identify investment accounts
    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken
    });
    
    const accounts = accountsResponse.data.accounts;
    const investmentAccounts = accounts.filter(acc => acc.type === 'investment');
    
    if (investmentAccounts.length === 0) {
      console.log(`No investment accounts found for item ${itemId}`);
      return [];
    }
    
    // Get investment holdings
    const holdingsResponse = await plaidClient.investmentsHoldingsGet({
      access_token: accessToken
    });
    
    const holdings = holdingsResponse.data.holdings || [];
    const securities = holdingsResponse.data.securities || [];
    const accountsData = holdingsResponse.data.accounts || [];
    
    // Also get account balances from accountsGet (more reliable for balances)
    const accountsWithBalances = accounts.filter(acc => acc.type === 'investment');
    const accountBalancesMap = {};
    accountsWithBalances.forEach(acc => {
      accountBalancesMap[acc.account_id] = acc.balances;
    });
    
    // Debug: Log first holding to see structure
    if (holdings.length > 0) {
      console.log('Sample holding structure:', JSON.stringify(holdings[0], null, 2));
      console.log('Sample security structure:', securities.length > 0 ? JSON.stringify(securities[0], null, 2) : 'No securities');
      console.log('Sample account structure:', accountsData.length > 0 ? JSON.stringify(accountsData[0], null, 2) : 'No accounts');
      console.log('Account balances from accountsGet:', accountBalancesMap);
    }
    
    // Create a map of securities by security_id
    const securitiesMap = {};
    securities.forEach(sec => {
      securitiesMap[sec.security_id] = sec;
    });
    
    // Create a map of accounts by account_id (merge with balances from accountsGet)
    const accountsMap = {};
    accountsData.forEach(acc => {
      accountsMap[acc.account_id] = {
        ...acc,
        balances: accountBalancesMap[acc.account_id] || acc.balances
      };
    });
    
    const investmentData = [];
    
    // Process each holding
    for (const holding of holdings) {
      const security = securitiesMap[holding.security_id];
      const account = accountsMap[holding.account_id];
      
      if (!security || !account) {
        console.warn(`Missing security or account data for holding ${holding.account_id}`);
        continue;
      }
      
      // Determine tax type
      const accountTaxType = determineAccountTaxType(
        account.subtype,
        account.name
      );
      
      // Calculate price and value
      // Try multiple sources for price/value in order of preference
      let price = 0;
      let value = 0;
      const quantity = holding.quantity || 0;
      
      // 1. Try institutional_price from holding
      if (holding.institutional_price && typeof holding.institutional_price === 'object') {
        price = holding.institutional_price.price || 0;
      } else if (typeof holding.institutional_price === 'number') {
        price = holding.institutional_price;
      }
      
      // 2. Try institutional_value from holding (most reliable)
      if (holding.institutional_value && typeof holding.institutional_value === 'object') {
        value = holding.institutional_value.amount || 0;
      } else if (typeof holding.institutional_value === 'number') {
        value = holding.institutional_value;
      }
      
      // 3. Fall back to security.close_price
      if (price === 0 && security.close_price) {
        price = security.close_price;
      }
      
      // 4. Calculate value from quantity * price if we have both
      if (value === 0 && quantity > 0 && price > 0) {
        value = quantity * price;
      }
      
      // 5. Last resort: use account balance divided by number of holdings (rough estimate)
      if (value === 0 && account.balances) {
        // Try current balance first, then available, then limit
        const accountBalance = account.balances.current || 
                               account.balances.available || 
                               account.balances.limit || 
                               0;
        
        if (accountBalance > 0) {
          const holdingsInAccount = holdings.filter(h => h.account_id === holding.account_id).length;
          if (holdingsInAccount > 0) {
            // Distribute account balance proportionally by quantity
            const totalQuantity = holdings
              .filter(h => h.account_id === holding.account_id)
              .reduce((sum, h) => sum + (h.quantity || 0), 0);
            
            if (totalQuantity > 0 && quantity > 0) {
              value = (accountBalance * quantity) / totalQuantity;
              price = value / quantity;
            } else {
              // Equal distribution if no quantities
              value = accountBalance / holdingsInAccount;
              price = quantity > 0 ? value / quantity : 0;
            }
          }
        }
      }
      
      // 6. Final fallback: Use default price of $10 for training data
      if (price === 0 || value === 0) {
        price = 10; // Default price for training data
        if (quantity > 0) {
          value = quantity * price;
        } else {
          // If no quantity, assume 1 share
          value = price;
          quantity = 1;
        }
        console.log(`📝 Using default price of $10 for ${security.name} (training data)`);
      }
      
      investmentData.push({
        accountId: holding.account_id,
        accountName: account.name,
        accountType: account.type,
        accountSubtype: account.subtype,
        securityId: holding.security_id,
        securityName: security.name,
        securityTicker: security.ticker_symbol,
        securityType: security.type,
        quantity: quantity,
        price: price,
        value: value,
        costBasis: holding.cost_basis?.amount || holding.cost_basis || 0,
        institutionName,
        institutionId,
        itemId,
        accountTaxType
      });
    }
    
    return investmentData;
  } catch (error) {
    console.error(`Error fetching investments from Plaid for item ${itemId}:`, error);
    throw error;
  }
}

/**
 * Sync investments for a specific client
 */
async function syncInvestmentsForClient(clientId) {
  try {
    const client = Client.findOne({ clientId });
    
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }
    
    if (!client.plaidAccessTokens || client.plaidAccessTokens.length === 0) {
      console.log(`No Plaid access tokens found for client ${clientId}`);
      return {
        success: true,
        message: 'No Plaid accounts connected',
        investmentsSynced: 0
      };
    }
    
    let totalInvestments = 0;
    const errors = [];
    
    // Process each access token
    for (const tokenData of client.plaidAccessTokens) {
      try {
        const investments = await fetchInvestmentsFromPlaid(
          tokenData.accessToken,
          tokenData.itemId,
          tokenData.institutionName,
          tokenData.institutionId
        );
        
        // Delete existing investments for this client's accounts
        for (const inv of investments) {
          // Delete existing investment for this account/security combination
          Investment.deleteMany({
            clientId,
            accountId: inv.accountId,
            securityId: inv.securityId
          });
          
          // Create new investment record
          Investment.create({
            clientId,
            ...inv
          });
          
          totalInvestments++;
        }
        
        console.log(`✅ Synced ${investments.length} investments for item ${tokenData.itemId}`);
      } catch (error) {
        console.error(`Error syncing investments for item ${tokenData.itemId}:`, error);
        errors.push({
          itemId: tokenData.itemId,
          error: error.message
        });
      }
    }
    
    return {
      success: true,
      message: `Synced ${totalInvestments} investment holdings`,
      investmentsSynced: totalInvestments,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error(`Error syncing investments for client ${clientId}:`, error);
    throw error;
  }
}

module.exports = {
  syncInvestmentsForClient,
  fetchInvestmentsFromPlaid,
  determineAccountTaxType
};

