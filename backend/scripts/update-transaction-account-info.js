const { getDatabase } = require('../database');
const { createPlaidClient } = require('../utils/plaidConfig');
const Client = require('../models-sqlite/Client');
require('dotenv').config();

// Initialize Plaid client
const plaidClient = createPlaidClient();

async function updateTransactionAccountInfo() {
  const db = getDatabase();
  
  // Get all clients
  const clients = await Client.find({});
  
  for (const client of clients) {
    console.log(`\n📊 Updating transactions for client: ${client.clientId}`);
    
    // Get all transactions for this client that are missing account info
    const transactions = db.prepare(`
      SELECT DISTINCT accountId 
      FROM transactions 
      WHERE clientId = ? 
        AND (accountType IS NULL OR accountName IS NULL)
    `).all(client.clientId);
    
    if (transactions.length === 0) {
      console.log(`  ✅ All transactions already have account info`);
      continue;
    }
    
    const accountIds = [...new Set(transactions.map(t => t.accountId))];
    console.log(`  Found ${accountIds.length} unique accounts to update`);
    
    // Process each Plaid connection
    for (const plaidConnection of client.plaidAccessTokens || []) {
      if (!plaidConnection.isActive) continue;
      
      // Skip test tokens
      if (plaidConnection.accessToken === 'access-sandbox-test-token' || 
          plaidConnection.accessToken.startsWith('test-')) {
        continue;
      }
      
      try {
        // Get account information
        const accountsResponse = await plaidClient.accountsGet({
          access_token: plaidConnection.accessToken
        });
        
        // Create maps
        const accountInfoMap = {};
        accountsResponse.data.accounts.forEach(account => {
          const typeLabel = account.type === 'credit' ? 'Credit Card' : 
                           account.type === 'depository' ? (account.subtype === 'checking' ? 'Checking' : account.subtype === 'savings' ? 'Savings' : 'Depository') :
                           account.type === 'loan' ? 'Loan' :
                           account.type === 'investment' ? 'Investment' : account.type;
          
          accountInfoMap[account.account_id] = {
            type: account.type,
            subtype: account.subtype,
            name: account.name || `${typeLabel} ${account.mask ? `****${account.mask}` : ''}`.trim(),
            mask: account.mask || null
          };
        });
        
        // Update transactions for accounts in this connection
        const updateStmt = db.prepare(`
          UPDATE transactions 
          SET accountType = ?,
              accountSubtype = ?,
              accountName = ?,
              accountMask = ?
          WHERE accountId = ? 
            AND clientId = ?
            AND (accountType IS NULL OR accountName IS NULL)
        `);
        
        let updated = 0;
        for (const accountId of accountIds) {
          if (accountInfoMap[accountId]) {
            const info = accountInfoMap[accountId];
            const result = updateStmt.run(
              info.type,
              info.subtype,
              info.name,
              info.mask,
              accountId,
              client.clientId
            );
            updated += result.changes;
          }
        }
        
        console.log(`  ✅ Updated ${updated} transactions for ${plaidConnection.institutionName}`);
        
      } catch (error) {
        console.error(`  ❌ Error updating ${plaidConnection.institutionName}:`, error.message);
      }
    }
  }
  
  console.log('\n✅ Account info update complete!');
}

updateTransactionAccountInfo()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });

