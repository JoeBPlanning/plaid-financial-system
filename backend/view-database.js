const { getDatabase } = require('./database');

const db = getDatabase();

console.log('\n📊 DATABASE CONTENTS\n');
console.log('='.repeat(50));

// Clients
console.log('\n👤 CLIENTS:');
const clients = db.prepare('SELECT * FROM clients').all();
clients.forEach(client => {
  console.log(`\n  Client ID: ${client.clientId}`);
  console.log(`  Username: ${client.username || 'N/A'}`);
  console.log(`  Password: ${client.password || 'N/A'}`);
  console.log(`  Name: ${client.name}`);
  console.log(`  Email: ${client.email}`);
  console.log(`  Advisor ID: ${client.advisorId}`);
  
  // Get Plaid tokens for this client
  const tokens = db.prepare('SELECT * FROM plaid_access_tokens WHERE clientId = ?').all(client.clientId);
  console.log(`  Bank Connections: ${tokens.length}`);
  tokens.forEach(token => {
    console.log(`    - ${token.institutionName} (${token.itemId})`);
    console.log(`      Accounts: ${JSON.parse(token.accountIds || '[]').length} accounts`);
    console.log(`      Active: ${token.isActive === 1 ? 'Yes' : 'No'}`);
  });
});

// Transactions summary
console.log('\n\n💳 TRANSACTIONS SUMMARY:');
const transactionCount = db.prepare('SELECT COUNT(*) as count FROM transactions').get();
console.log(`  Total Transactions: ${transactionCount.count}`);

const transactionsByMonth = db.prepare(`
  SELECT monthYear, COUNT(*) as count 
  FROM transactions 
  GROUP BY monthYear 
  ORDER BY monthYear DESC
`).all();
console.log('\n  By Month:');
transactionsByMonth.forEach(row => {
  console.log(`    ${row.monthYear}: ${row.count} transactions`);
});

// Sample transactions
console.log('\n\n📝 SAMPLE TRANSACTIONS (Last 5):');
const sampleTransactions = db.prepare(`
  SELECT plaidTransactionId, name, amount, date, monthYear, institution
  FROM transactions 
  ORDER BY date DESC 
  LIMIT 5
`).all();
sampleTransactions.forEach(txn => {
  console.log(`\n  ${txn.name}`);
  console.log(`    Amount: $${txn.amount}`);
  console.log(`    Date: ${txn.date}`);
  console.log(`    Month: ${txn.monthYear}`);
  console.log(`    Institution: ${txn.institution || 'N/A'}`);
});

// Monthly summaries
console.log('\n\n📈 MONTHLY SUMMARIES:');
const summaries = db.prepare(`
  SELECT clientId, monthYear, transactionsProcessed 
  FROM monthly_summaries 
  ORDER BY monthYear DESC 
  LIMIT 5
`).all();
summaries.forEach(summary => {
  const cashFlow = JSON.parse(db.prepare('SELECT cashFlow FROM monthly_summaries WHERE clientId = ? AND monthYear = ?').get(summary.clientId, summary.monthYear)?.cashFlow || '{}');
  console.log(`\n  ${summary.monthYear}:`);
  console.log(`    Transactions Processed: ${summary.transactionsProcessed}`);
  console.log(`    Income: $${cashFlow.income || 0}`);
  console.log(`    Expenses: $${cashFlow.totalExpenses || 0}`);
});

console.log('\n' + '='.repeat(50));
console.log('\n✅ Database contains data! Use DB Browser for SQLite to view it visually.\n');

