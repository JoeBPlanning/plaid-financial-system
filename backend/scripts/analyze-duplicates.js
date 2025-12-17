const { getDatabase } = require('../database');

const db = getDatabase();

console.log('\n📊 Analyzing transactions for duplicates...\n');

// 1. Check by plaidTransactionId
const byId = db.prepare(`
  SELECT plaidTransactionId, COUNT(*) as count
  FROM transactions
  GROUP BY plaidTransactionId
  HAVING count > 1
`).all();

console.log(`1. Duplicates by Transaction ID: ${byId.length}`);

// 2. Check by exact match (ID + account + date + amount)
const exact = db.prepare(`
  SELECT plaidTransactionId, accountId, date, amount, COUNT(*) as count
  FROM transactions
  GROUP BY plaidTransactionId, accountId, date, amount
  HAVING count > 1
`).all();

console.log(`2. Exact duplicates (ID + account + date + amount): ${exact.length}`);

// 3. Check by name + amount + date (same transaction, different IDs)
const byName = db.prepare(`
  SELECT name, amount, date, accountId, COUNT(*) as count, GROUP_CONCAT(DISTINCT plaidTransactionId) as ids
  FROM transactions
  GROUP BY name, amount, date, accountId
  HAVING count > 1
`).all();

console.log(`3. Same name/amount/date/account but different IDs: ${byName.length}`);

// 4. Show examples
if (byId.length > 0) {
  console.log('\n📋 Examples of duplicates by Transaction ID:');
  byId.slice(0, 3).forEach(dup => {
    const txs = db.prepare(`
      SELECT id, name, amount, date, accountName, accountId
      FROM transactions
      WHERE plaidTransactionId = ?
      ORDER BY id
    `).all(dup.plaidTransactionId);
    
    console.log(`\n  Transaction ID: ${dup.plaidTransactionId} (${dup.count} copies)`);
    txs.forEach(t => {
      console.log(`    - DB ID: ${t.id}, Name: ${t.name}, Amount: $${t.amount}, Date: ${t.date}, Account: ${t.accountName || t.accountId}`);
    });
  });
}

if (exact.length > 0) {
  console.log('\n📋 Examples of exact duplicates:');
  exact.slice(0, 3).forEach(dup => {
    const txs = db.prepare(`
      SELECT id, name, accountName
      FROM transactions
      WHERE plaidTransactionId = ? AND accountId = ? AND date = ? AND amount = ?
      ORDER BY id
    `).all(dup.plaidTransactionId, dup.accountId, dup.date, dup.amount);
    
    console.log(`\n  "${txs[0].name}" - ${dup.count} copies`);
    txs.forEach(t => {
      console.log(`    - DB ID: ${t.id}, Account: ${t.accountName || dup.accountId}`);
    });
  });
}

if (byName.length > 0) {
  console.log('\n📋 Examples of same name/amount/date but different IDs:');
  byName.slice(0, 3).forEach(dup => {
    console.log(`\n  "${dup.name}" - $${dup.amount} on ${dup.date} (${dup.count} copies)`);
    console.log(`    Transaction IDs: ${dup.ids}`);
    console.log(`    These might be legitimate recurring transactions or true duplicates`);
  });
}

// Summary
const total = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
const uniqueIds = db.prepare('SELECT COUNT(DISTINCT plaidTransactionId) as count FROM transactions').get().count;

console.log(`\n📊 Summary:`);
console.log(`   Total transactions: ${total}`);
console.log(`   Unique transaction IDs: ${uniqueIds}`);
console.log(`   Duplicates by ID: ${byId.length}`);
console.log(`   Exact duplicates: ${exact.length}`);
console.log(`   Same name/amount/date: ${byName.length}\n`);

if (byId.length === 0 && exact.length === 0) {
  console.log('✅ No true duplicates found!');
  console.log('   If you see duplicates in the UI, they might be:');
  console.log('   - Recurring transactions (same name/amount in different months)');
  console.log('   - Same transaction from different accounts');
  console.log('   - A display issue in the frontend\n');
}

