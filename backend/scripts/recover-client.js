const { getDatabase } = require('../database');
const Client = require('../models-sqlite/Client');

async function recoverClient() {
  const db = getDatabase();

  console.log('\n🔍 Checking client status...\n');

  // Check if test client exists
  const client = await Client.findOne({ clientId: 'client_test_user' });

if (client) {
  console.log('✅ Client found in database:');
  console.log(`   Client ID: ${client.clientId}`);
  console.log(`   Username: ${client.username}`);
  console.log(`   Email: ${client.email}`);
  console.log(`   Name: ${client.name}`);
  console.log(`   Active: ${client.isActive}`);
  console.log(`   Plaid Connections: ${client.plaidAccessTokens?.length || 0}\n`);
  
  if (client.plaidAccessTokens && client.plaidAccessTokens.length > 0) {
    console.log('📊 Plaid Connections:');
    client.plaidAccessTokens.forEach((conn, idx) => {
      console.log(`   ${idx + 1}. ${conn.institutionName || 'Unknown'}`);
      console.log(`      Item ID: ${conn.itemId}`);
      console.log(`      Active: ${conn.isActive}`);
      console.log(`      Cursor: ${conn.transactionCursor || 'none'}`);
    });
  } else {
    console.log('⚠️  No Plaid connections found for this client.\n');
  }
  
  // Check transactions
  const txCount = db.prepare('SELECT COUNT(*) as count FROM transactions WHERE clientId = ?').get(client.clientId);
  console.log(`\n📈 Transactions: ${txCount.count}`);
  
} else {
  console.log('❌ Client not found in database!\n');
  console.log('💡 To recreate the test client, run:');
  console.log('   curl -X POST http://localhost:3001/api/force-create-test-user\n');
  console.log('   Or use the endpoint in your API client.\n');
}

  process.exit(0);
}

recoverClient().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

