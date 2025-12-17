const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Database file location (in backend directory)
const DB_PATH = path.join(__dirname, 'plaid-financial-system.db');

// Create database connection
let db;

function initDatabase() {
  // Create database file if it doesn't exist
  db = new Database(DB_PATH);
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Create tables
  createTables();
  
  console.log(`📦 SQLite database initialized: ${DB_PATH}`);
  return db;
}

function createTables() {
  // Clients table
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      isActive INTEGER DEFAULT 1,
      advisorId TEXT NOT NULL,
      preferences TEXT, -- JSON string
      clientProfile TEXT, -- JSON string
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Plaid Access Tokens table (linked to clients)
  db.exec(`
    CREATE TABLE IF NOT EXISTS plaid_access_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId TEXT NOT NULL,
      accessToken TEXT NOT NULL,
      itemId TEXT NOT NULL,
      institutionName TEXT,
      institutionId TEXT,
      accountIds TEXT, -- JSON array string
      isActive INTEGER DEFAULT 1,
      connectedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      transactionCursor TEXT,
      FOREIGN KEY (clientId) REFERENCES clients(clientId) ON DELETE CASCADE
    )
  `);

  // Transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId TEXT NOT NULL,
      plaidTransactionId TEXT UNIQUE NOT NULL,
      accountId TEXT NOT NULL,
      accountType TEXT, -- credit, depository, loan, investment, etc.
      accountSubtype TEXT, -- checking, savings, credit card, etc.
      accountName TEXT, -- Human-readable account name (e.g., "Chase Checking", "Visa Credit Card")
      accountMask TEXT, -- Last 4 digits or account mask
      amount REAL NOT NULL,
      date DATETIME NOT NULL,
      name TEXT NOT NULL,
      merchantName TEXT,
      category TEXT, -- JSON array string
      plaidCategory TEXT,
      plaidSubCategory TEXT,
      personalFinanceCategory TEXT, -- JSON string
      suggestedCategory TEXT NOT NULL,
      userCategory TEXT,
      isReviewed INTEGER DEFAULT 0,
      monthYear TEXT NOT NULL,
      notes TEXT,
      institution TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Add accountType, accountSubtype, accountName, and accountMask columns if they don't exist (for existing databases)
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN accountType TEXT;`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN accountSubtype TEXT;`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN accountName TEXT;`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE transactions ADD COLUMN accountMask TEXT;`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Monthly Summaries table
  db.exec(`
    CREATE TABLE IF NOT EXISTS monthly_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId TEXT NOT NULL,
      monthYear TEXT NOT NULL,
      date DATETIME NOT NULL,
      year INTEGER NOT NULL,
      cashFlow TEXT NOT NULL, -- JSON string
      netWorth TEXT NOT NULL, -- JSON string
      clientProfile TEXT, -- JSON string
      transactionsProcessed INTEGER DEFAULT 0,
      lastProcessedAt DATETIME,
      reviewStatus TEXT DEFAULT 'pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clientId, monthYear)
    )
  `);

  // Investments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS investments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId TEXT NOT NULL,
      accountId TEXT NOT NULL,
      accountName TEXT,
      accountType TEXT,
      accountSubtype TEXT,
      securityId TEXT NOT NULL,
      securityName TEXT,
      securityTicker TEXT,
      securityType TEXT,
      quantity REAL DEFAULT 0,
      price REAL DEFAULT 0,
      value REAL DEFAULT 0,
      costBasis REAL DEFAULT 0,
      institutionName TEXT,
      institutionId TEXT,
      itemId TEXT,
      accountTaxType TEXT, -- tax-free, tax-deferred, taxable
      lastUpdated DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clientId, accountId, securityId)
    )
  `);

  // Balance Sheet snapshots table
  db.exec(`
    CREATE TABLE IF NOT EXISTS balance_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId TEXT NOT NULL,
      snapshotDate DATE NOT NULL,
      monthYear TEXT, -- Format: YYYY-MM for easy querying
      assets REAL DEFAULT 0,
      liabilities REAL DEFAULT 0,
      netWorth REAL DEFAULT 0,
      assetBreakdown TEXT NOT NULL, -- JSON string with subcategories
      liabilityBreakdown TEXT NOT NULL, -- JSON string with subcategories
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clientId, snapshotDate)
    )
  `);

  // Investment snapshots table
  db.exec(`
    CREATE TABLE IF NOT EXISTS investment_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientId TEXT NOT NULL,
      snapshotDate DATE NOT NULL,
      monthYear TEXT, -- Format: YYYY-MM for easy querying
      totalValue REAL DEFAULT 0,
      totalByTaxType TEXT NOT NULL, -- JSON string: {tax-free, tax-deferred, taxable}
      holdingsByAccount TEXT NOT NULL, -- JSON array of account holdings
      assetClassBreakdown TEXT NOT NULL, -- JSON string with asset class breakdown
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(clientId, snapshotDate)
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_clients_clientId ON clients(clientId);
    CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
    CREATE INDEX IF NOT EXISTS idx_clients_username ON clients(username);
    CREATE INDEX IF NOT EXISTS idx_plaid_tokens_clientId ON plaid_access_tokens(clientId);
    CREATE INDEX IF NOT EXISTS idx_transactions_clientId ON transactions(clientId);
    CREATE INDEX IF NOT EXISTS idx_transactions_monthYear ON transactions(monthYear);
    CREATE INDEX IF NOT EXISTS idx_transactions_plaidId ON transactions(plaidTransactionId);
    CREATE INDEX IF NOT EXISTS idx_transactions_client_month ON transactions(clientId, monthYear);
    CREATE INDEX IF NOT EXISTS idx_summaries_client_month ON monthly_summaries(clientId, monthYear);
    CREATE INDEX IF NOT EXISTS idx_investments_clientId ON investments(clientId);
    CREATE INDEX IF NOT EXISTS idx_investments_accountId ON investments(accountId);
    CREATE INDEX IF NOT EXISTS idx_investments_securityId ON investments(securityId);
    CREATE INDEX IF NOT EXISTS idx_balance_sheets_clientId ON balance_sheets(clientId);
    CREATE INDEX IF NOT EXISTS idx_balance_sheets_snapshotDate ON balance_sheets(snapshotDate);
    CREATE INDEX IF NOT EXISTS idx_balance_sheets_monthYear ON balance_sheets(monthYear);
    CREATE INDEX IF NOT EXISTS idx_balance_sheets_client_date ON balance_sheets(clientId, snapshotDate);
    CREATE INDEX IF NOT EXISTS idx_investment_snapshots_clientId ON investment_snapshots(clientId);
    CREATE INDEX IF NOT EXISTS idx_investment_snapshots_snapshotDate ON investment_snapshots(snapshotDate);
    CREATE INDEX IF NOT EXISTS idx_investment_snapshots_monthYear ON investment_snapshots(monthYear);
    CREATE INDEX IF NOT EXISTS idx_investment_snapshots_client_date ON investment_snapshots(clientId, snapshotDate);
  `);
}

function getDatabase() {
  if (!db) {
    return initDatabase();
  }
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  closeDatabase,
  DB_PATH
};

