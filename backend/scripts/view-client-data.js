const { getDatabase } = require('../database');
const Client = require('../models-sqlite/Client');

async function viewClientData() {
  const db = getDatabase();

  console.log('\n📊 Client Database Status\n');
  console.log('='.repeat(50));

  // Get all clients
  const clients = await Client.find({});
  console.log(`\n👥 Total Clients: ${clients.length}\n`);

  for (const client of clients) {
    console.log(`Client ID: ${client.clientId}`);
    console.log(`  Username: ${client.username || 'N/A'}`);
    console.log(`  Email: ${client.email || 'N/A'}`);
    console.log(`  Name: ${client.name || 'N/A'}`);
    console.log(`  Active: ${client.isActive ? 'Yes' : 'No'}`);
    
    // Plaid connections
    const plaidCount = client.plaidAccessTokens?.length || 0;
    console.log(`  Plaid Connections: ${plaidCount}`);
    
    if (plaidCount > 0) {
      client.plaidAccessTokens.forEach((conn, idx) => {
        console.log(`    ${idx + 1}. ${conn.institutionName || 'Unknown Institution'}`);
        console.log(`       Item ID: ${conn.itemId}`);
        console.log(`       Active: ${conn.isActive ? 'Yes' : 'No'}`);
        console.log(`       Has Cursor: ${conn.transactionCursor ? 'Yes' : 'No'}`);
      });
    }
    
    // Transaction count
    const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE clientId = ?').get(client.clientId);
    console.log(`  Transactions: ${txCount.count}`);
    
    console.log('');
  }

  // Summary
  const totalTx = db.prepare('SELECT COUNT(*) as count FROM transactions').get();
  const totalPlaid = db.prepare('SELECT COUNT(*) as count FROM plaid_access_tokens').get();
  
  console.log('='.repeat(50));
  console.log('\n📈 Database Summary:');
  console.log(`   Clients: ${clients.length}`);
  console.log(`   Plaid Connections: ${totalPlaid.count}`);
  console.log(`   Total Transactions: ${totalTx.count}\n`);
}

viewClientData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

