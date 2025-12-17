# TransactionsSync Implementation

This document explains the new `transactionsSync` implementation based on the Plaid Quickstart pattern.

## Overview

The backend has been updated to use Plaid's `transactionsSync` API instead of the deprecated `transactionsGet` API. This provides:

- **Cursor-based pagination**: Efficiently syncs only new/updated transactions
- **Incremental updates**: Only fetches changes since last sync
- **Database storage**: All transactions are stored in SQLite
- **Automatic handling**: Manages added, modified, and removed transactions

## What Changed

### 1. Client Model (`backend/models-sqlite/Client.js`)
- Added `transactionCursor` field to `plaidAccessTokens` array in the database
- Stores the sync cursor for each Plaid connection to track sync state

### 2. Transaction Model (`backend/models-sqlite/Transaction.js`)
- Added `institution` field to track which bank the transaction came from
- Added `personalFinanceCategory` field for Plaid's enhanced categorization

### 3. New Service (`backend/services/transactionsSync.js`)
- `syncTransactionsForClient()`: Main function to sync all transactions for a client
- `syncTransactionsForItem()`: Syncs transactions for a specific Plaid item/connection
- `getTransactionsFromDatabase()`: Retrieves transactions from SQLite database

### 4. Updated Routes (`backend/server.js`)
- **POST `/api/clients/:clientId/sync-transactions`**: New endpoint to trigger transaction sync
- **GET `/api/clients/:clientId/transactions`**: Updated to use database-first approach
- **GET `/api/admin/transactions/:clientId`**: Updated to use database-first approach

## How to Use

### 1. Initial Sync (First Time)

When a client first connects their bank account, you need to perform an initial sync:

```bash
POST /api/clients/:clientId/sync-transactions
```

This will:
- Fetch all historical transactions
- Store them in the database
- Save the cursor for future incremental syncs

### 2. Regular Syncs

For ongoing updates, call the same endpoint periodically (or set up webhooks):

```bash
POST /api/clients/:clientId/sync-transactions
```

This will:
- Only fetch new/updated transactions since last sync
- Update modified transactions
- Remove deleted transactions
- Update the cursor

### 3. Get Transactions

After syncing, retrieve transactions from the database:

```bash
GET /api/clients/:clientId/transactions?month=2025-01
GET /api/clients/:clientId/transactions?months=3
GET /api/clients/:clientId/transactions?limit=100
```

### 4. Sync Specific Item

To sync only a specific bank connection:

```bash
POST /api/clients/:clientId/sync-transactions
Content-Type: application/json

{
  "itemId": "item_1234567890"
}
```

## Response Format

### Sync Response

```json
{
  "success": true,
  "message": "Transaction sync completed",
  "clientId": "client_123",
  "itemsProcessed": 2,
  "transactionsAdded": 45,
  "transactionsModified": 3,
  "transactionsRemoved": 1,
  "errors": []
}
```

### Get Transactions Response

```json
{
  "success": true,
  "transactions": [...],
  "count": 45,
  "source": "database"
}
```

## Migration from transactionsGet

If you have existing code using `transactionsGet`:

1. **Replace** calls to `transactionsGet` with `sync-transactions` endpoint
2. **Update** transaction retrieval to use the database-first approach
3. **Remove** date range parameters (transactionsSync handles this automatically)

## Best Practices

1. **Initial Setup**: Run sync after connecting a new bank account
2. **Regular Updates**: Sync daily or set up webhooks for real-time updates
3. **Error Handling**: Check the `errors` array in sync response
4. **Database First**: Always query the database first, sync only when needed

## Webhooks (Future Enhancement)

For production, consider implementing Plaid webhooks to trigger syncs automatically when transactions are updated. See:
- https://github.com/plaid/tutorial-resources
- https://github.com/plaid/pattern

## Notes

- The cursor is stored per Plaid connection (item)
- Empty cursor (`""`) means no transactions available yet (will poll)
- Transactions are automatically categorized using `TransactionProcessor`
- All transactions are stored with `monthYear` field for efficient querying

