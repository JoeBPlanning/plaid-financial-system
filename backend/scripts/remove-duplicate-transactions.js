const { getDatabase } = require('../database');

const db = getDatabase();

// Check if user wants to remove exact duplicates (same ID + account + date + amount)
const removeExact = process.argv.includes('--remove-exact') || process.argv.includes('--aggressive');
const removeByContent = process.argv.includes('--by-content') || process.argv.includes('--aggressive');

console.log('\n🔍 Checking for duplicate transactions...\n');

// Check total vs unique
const stats = db.prepare(`
  SELECT 
    COUNT(*) as total,
    COUNT(DISTINCT plaidTransactionId) as unique_ids
  FROM transactions
`).get();

console.log(`Total transactions: ${stats.total}`);
console.log(`Unique transaction IDs: ${stats.unique_ids}`);
console.log(`Potential duplicates: ${stats.total - stats.unique_ids}\n`);

// Find duplicates by plaidTransactionId (same transaction ID = true duplicate)
const duplicates = db.prepare(`
  SELECT plaidTransactionId, COUNT(*) as count
  FROM transactions
  GROUP BY plaidTransactionId
  HAVING count > 1
`).all();

console.log(`Found ${duplicates.length} duplicate transaction IDs\n`);

// Find exact duplicates (same ID + account + date + amount)
const exactDuplicates = db.prepare(`
  SELECT plaidTransactionId, accountId, date, amount, COUNT(*) as count
  FROM transactions
  GROUP BY plaidTransactionId, accountId, date, amount
  HAVING count > 1
`).all();

// Find duplicates by content (same name + amount + date + account, different IDs)
// Group by accountName (or accountId if accountName is null) since accountId can differ for same account
const contentDuplicates = db.prepare(`
  SELECT name, amount, date, COALESCE(accountName, accountId) as account, COUNT(*) as count, 
         GROUP_CONCAT(id) as db_ids, GROUP_CONCAT(plaidTransactionId) as plaid_ids
  FROM transactions
  GROUP BY name, amount, date, COALESCE(accountName, accountId)
  HAVING count > 1
`).all();

if (exactDuplicates.length > 0) {
  console.log(`⚠️  Found ${exactDuplicates.length} exact duplicates (same ID, account, date, amount):\n`);
  exactDuplicates.slice(0, 5).forEach(dup => {
    const transactions = db.prepare(`
      SELECT id, name, amount, date, accountName
      FROM transactions
      WHERE plaidTransactionId = ? AND accountId = ? AND date = ? AND amount = ?
      ORDER BY id DESC
    `).all(dup.plaidTransactionId, dup.accountId, dup.date, dup.amount);
    
    console.log(`  Transaction: ${transactions[0].name} (${dup.count} copies)`);
    transactions.forEach(t => {
      console.log(`    - ID: ${t.id}, Date: ${t.date}, Account: ${t.accountName || dup.accountId}`);
    });
  });
  
  if (!removeExact) {
    console.log('\n💡 To remove these exact duplicates, run:');
    console.log('   node scripts/remove-duplicate-transactions.js --remove-exact\n');
  }
}

if (contentDuplicates.length > 0) {
  console.log(`⚠️  Found ${contentDuplicates.length} duplicates by content (same name, amount, date, account, different IDs):\n`);
  contentDuplicates.slice(0, 5).forEach(dup => {
    console.log(`  "${dup.name}" - $${dup.amount} on ${dup.date} from ${dup.account} (${dup.count} copies)`);
    console.log(`    Database IDs: ${dup.db_ids}`);
    console.log(`    Plaid IDs: ${dup.plaid_ids}\n`);
  });
  
  if (!removeByContent) {
    console.log('\n💡 To remove these content-based duplicates, run:');
    console.log('   node scripts/remove-duplicate-transactions.js --by-content\n');
    console.log('   Or use --aggressive to remove both exact and content duplicates.\n');
  }
}

if (duplicates.length === 0 && exactDuplicates.length === 0 && contentDuplicates.length === 0) {
  console.log('✅ No duplicates found!\n');
  process.exit(0);
}

if (duplicates.length === 0 && !removeExact && !removeByContent) {
  console.log('\n💡 If you still see duplicates, they might be:');
  console.log('   - Same transaction from different accounts (normal)');
  console.log('   - Same transaction in different months (normal recurring transactions)');
  console.log('   - Transactions with same name/amount but different IDs (different transactions)\n');
  process.exit(0);
}

console.log('\n\n🗑️  Removing duplicates...\n');

let totalRemoved = 0;

// Remove duplicates by plaidTransactionId
if (duplicates.length > 0) {
  for (const dup of duplicates) {
    // Get all instances of this transaction
    const instances = db.prepare(`
      SELECT id FROM transactions
      WHERE plaidTransactionId = ?
      ORDER BY id DESC
    `).all(dup.plaidTransactionId);
    
    // Keep the first one (most recent), delete the rest
    const keepId = instances[0].id;
    const deleteIds = instances.slice(1).map(i => i.id);
    
    if (deleteIds.length > 0) {
      const placeholders = deleteIds.map(() => '?').join(',');
      const deleteStmt = db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`);
      const result = deleteStmt.run(...deleteIds);
      totalRemoved += result.changes;
      console.log(`  Removed ${result.changes} duplicate(s) of ${dup.plaidTransactionId} (kept ID: ${keepId})`);
    }
  }
}

// Remove exact duplicates if requested
if (removeExact && exactDuplicates.length > 0) {
  console.log('\n🗑️  Removing exact duplicates (same ID, account, date, amount)...\n');
  
  for (const dup of exactDuplicates) {
    // Get all instances of this exact duplicate
    const instances = db.prepare(`
      SELECT id FROM transactions
      WHERE plaidTransactionId = ? AND accountId = ? AND date = ? AND amount = ?
      ORDER BY id DESC
    `).all(dup.plaidTransactionId, dup.accountId, dup.date, dup.amount);
    
    // Keep the first one (most recent), delete the rest
    const keepId = instances[0].id;
    const deleteIds = instances.slice(1).map(i => i.id);
    
    if (deleteIds.length > 0) {
      const placeholders = deleteIds.map(() => '?').join(',');
      const deleteStmt = db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`);
      const result = deleteStmt.run(...deleteIds);
      totalRemoved += result.changes;
      
      const transaction = db.prepare('SELECT name FROM transactions WHERE id = ?').get(keepId);
      console.log(`  Removed ${result.changes} exact duplicate(s) of "${transaction.name}" (kept ID: ${keepId})`);
    }
  }
}

// Remove content-based duplicates if requested
if (removeByContent && contentDuplicates.length > 0) {
  console.log('\n🗑️  Removing content-based duplicates (same name, amount, date, account)...\n');
  
  for (const dup of contentDuplicates) {
    // Get all instances of this duplicate
    // Match by accountName if it exists, otherwise by accountId
    const instances = db.prepare(`
      SELECT id FROM transactions
      WHERE name = ? AND amount = ? AND date = ? 
        AND COALESCE(accountName, accountId) = ?
      ORDER BY id DESC
    `).all(dup.name, dup.amount, dup.date, dup.account);
    
    // Keep the first one (most recent), delete the rest
    const keepId = instances[0].id;
    const deleteIds = instances.slice(1).map(i => i.id);
    
    if (deleteIds.length > 0) {
      const placeholders = deleteIds.map(() => '?').join(',');
      const deleteStmt = db.prepare(`DELETE FROM transactions WHERE id IN (${placeholders})`);
      const result = deleteStmt.run(...deleteIds);
      totalRemoved += result.changes;
      
      console.log(`  Removed ${result.changes} duplicate(s) of "${dup.name}" on ${dup.date} (kept ID: ${keepId})`);
    }
  }
}

console.log(`\n✅ Removed ${totalRemoved} duplicate transactions`);

// Verify
const finalCount = db.prepare('SELECT COUNT(*) as total, COUNT(DISTINCT plaidTransactionId) as unique_count FROM transactions').get();
console.log(`\n📊 Final counts:`);
console.log(`   Total transactions: ${finalCount.total}`);
console.log(`   Unique transactions: ${finalCount.unique_count}`);
console.log(`   Duplicates remaining: ${finalCount.total - finalCount.unique_count}\n`);

// Check for remaining duplicates
const remainingExact = db.prepare(`
  SELECT plaidTransactionId, accountId, date, amount, COUNT(*) as count
  FROM transactions
  GROUP BY plaidTransactionId, accountId, date, amount
  HAVING count > 1
`).all();

const remainingContent = db.prepare(`
  SELECT name, amount, date, COALESCE(accountName, accountId) as account, COUNT(*) as count
  FROM transactions
  GROUP BY name, amount, date, COALESCE(accountName, accountId)
  HAVING count > 1
`).all();

if (remainingExact.length > 0) {
  console.log(`⚠️  Still found ${remainingExact.length} exact duplicates (same ID, account, date, amount)`);
  console.log('   These might be legitimate recurring transactions or need manual review.\n');
}

if (remainingContent.length > 0) {
  console.log(`⚠️  Still found ${remainingContent.length} content-based duplicates`);
  console.log('   These might be legitimate recurring transactions or need manual review.\n');
}
