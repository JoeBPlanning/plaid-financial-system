# Balance Sheet Snapshot System

This document describes the balance sheet snapshot system for capturing monthly financial snapshots.

## Overview

The balance sheet snapshot system captures a point-in-time view of a client's financial position, including:
- Total assets and breakdown by account type
- Total liabilities and breakdown by account type
- Net worth calculation

## Database Schema

### Table: `balance_sheets`

```sql
CREATE TABLE balance_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clientId TEXT NOT NULL,
  snapshotDate DATE NOT NULL,
  monthYear TEXT, -- Format: YYYY-MM
  assets REAL DEFAULT 0,
  liabilities REAL DEFAULT 0,
  netWorth REAL DEFAULT 0,
  assetBreakdown TEXT NOT NULL, -- JSON string
  liabilityBreakdown TEXT NOT NULL, -- JSON string
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(clientId, snapshotDate)
);
```

### Asset Breakdown Structure
```json
{
  "checking": 0,
  "savings": 0,
  "investments": 0,
  "realEstate": 0,
  "total": 0
}
```

### Liability Breakdown Structure
```json
{
  "creditCards": 0,
  "studentLoans": 0,
  "mortgage": 0,
  "total": 0
}
```

## API Endpoints

### Capture Snapshot (Protected)
```
POST /api/clients/:clientId/balance-sheet-snapshot
Authorization: Bearer <token>

Body (optional):
{
  "snapshotDate": "2025-01-05" // YYYY-MM-DD format, defaults to today
}
```

### Get Snapshots (Protected)
```
GET /api/clients/:clientId/balance-sheets?startDate=2025-01-01&endDate=2025-12-31&limit=50
Authorization: Bearer <token>
```

### Admin: Capture All Clients (No Auth - for scheduled jobs)
```
POST /api/admin/capture-all-balance-sheets

Body (optional):
{
  "snapshotDate": "2025-01-05" // YYYY-MM-DD format, defaults to today
}
```

## Usage

### Manual Snapshot Capture
```javascript
const balanceSheetSnapshot = require('./services/balanceSheetSnapshot');

// Capture snapshot for a specific client
await balanceSheetSnapshot.captureBalanceSheetSnapshot('client_123', '2025-01-05');

// Capture snapshot for today
await balanceSheetSnapshot.captureBalanceSheetSnapshot('client_123');
```

### Capture All Clients
```javascript
// Capture snapshots for all active clients
await balanceSheetSnapshot.captureAllClientsSnapshots('2025-01-05');
```

### Monthly Snapshot (5th of month)
```javascript
// This will only capture if today is the 5th
await balanceSheetSnapshot.captureMonthlySnapshot('client_123');
```

## Scheduled Job Setup

To automatically capture snapshots on the 5th of each month, you can use:

### Option 1: Node-cron (Recommended)
```javascript
const cron = require('node-cron');
const balanceSheetSnapshot = require('./services/balanceSheetSnapshot');

// Run on the 5th of every month at 2 AM
cron.schedule('0 2 5 * *', async () => {
  console.log('Running monthly balance sheet snapshot...');
  await balanceSheetSnapshot.captureAllClientsSnapshots();
});
```

### Option 2: System Cron
Add to crontab:
```bash
0 2 5 * * cd /path/to/backend && node -e "require('./services/balanceSheetSnapshot').captureAllClientsSnapshots()"
```

### Option 3: API Endpoint (for external schedulers)
Set up an external cron service (like cron-job.org) to call:
```
POST https://your-api.com/api/admin/capture-all-balance-sheets
```

## Data Source

The snapshot system fetches current account balances directly from Plaid using the `accountsBalanceGet` API. This ensures:
- Real-time account balances
- Accurate asset/liability categorization
- Complete account coverage across all connected institutions

## Notes

- Snapshots are unique per client per date (enforced by UNIQUE constraint)
- If a snapshot already exists for a date, it will not be overwritten
- The system automatically categorizes accounts by type and subtype
- Investment accounts are included in assets
- Credit card balances are included in liabilities
- All amounts are stored in the database as REAL (floating point)

## Querying Snapshots

### Get all snapshots for a client
```javascript
const BalanceSheet = require('./models-sqlite/BalanceSheet');

const snapshots = await BalanceSheet.find({ clientId: 'client_123' });
```

### Get snapshots for a date range
```javascript
const snapshots = await BalanceSheet.find({
  clientId: 'client_123',
  snapshotDate: {
    $gte: '2025-01-01',
    $lte: '2025-12-31'
  }
});
```

### Get latest snapshot
```javascript
const snapshots = await BalanceSheet.find(
  { clientId: 'client_123' },
  { limit: 1 }
);
const latest = snapshots[0];
```

## Analytics Use Cases

The balance sheet snapshots enable:
1. **Net Worth Trends**: Track net worth changes over time
2. **Asset Growth**: Analyze asset growth patterns
3. **Debt Reduction**: Monitor liability reduction
4. **Account Balance History**: Historical view of account balances
5. **Monthly Reports**: Generate monthly financial reports for clients

