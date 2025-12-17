# Transactions Sync Best Practices

This document explains how we've implemented the `/transactions/sync` endpoint following Plaid's best practices to prevent duplicate transactions.

## Key Improvements

### 1. **Retrieve ALL Updates Before Persisting**
According to Plaid documentation, we must retrieve ALL available transaction updates before persisting them to the database. This prevents partial updates and ensures data consistency.

**Implementation:**
- We collect all `added`, `modified`, and `removed` transactions in arrays
- Only after pagination is complete (`has_more === false`) do we process and save transactions
- This ensures we have the complete picture before making database changes

### 2. **Proper Cursor Management**
The cursor is the key to preventing duplicates. It represents the point in time we've successfully synced up to.

**Cursor States:**
- `null` or `undefined`: First sync - will return all historical transactions
- `""` (empty string): No data available yet - will poll and wait
- `"cursor_string"`: Continue from last sync point

**Implementation:**
- Cursor is only saved AFTER all pages are successfully processed
- Cursor is stored per Plaid connection/item in the database
- On next sync, we use the stored cursor to continue from where we left off

### 3. **Error Handling: TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION**
If this error occurs during pagination, we must restart the entire pagination loop from the beginning (first cursor), not just retry the failed request.

**Implementation:**
- Detects `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` error
- Restarts from the initial cursor
- Clears all collected data and starts fresh
- Implements exponential backoff with max retries

### 4. **Removed Duplicate Prevention Logic**
We removed the manual duplicate check that was comparing transaction content (name, amount, date, account). This was interfering with the cursor-based sync system.

**Why:**
- The cursor-based system is the authoritative way to prevent duplicates
- Plaid's transaction IDs are unique and should be used as the primary key
- Manual duplicate checks can cause legitimate transactions to be skipped

**Current Approach:**
- Use `plaidTransactionId` as the unique identifier
- Rely on cursor-based pagination to prevent duplicates
- Use `upsert` operations to handle both new and existing transactions

## How It Works

1. **Initial Sync:**
   - Cursor is `null` → Plaid returns all historical transactions
   - Process all pages until `has_more === false`
   - Save final cursor to database

2. **Subsequent Syncs:**
   - Load stored cursor from database
   - Use cursor to get only new/updated/removed transactions since last sync
   - Process all pages
   - Update cursor in database

3. **Error Recovery:**
   - If `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` occurs:
     - Restart from initial cursor
     - Clear collected data
     - Retry with exponential backoff

## Database Schema

The cursor is stored in the `plaid_access_tokens` table:
- Column: `transactionCursor` (TEXT)
- Stored per Plaid connection/item
- Updated only after successful sync completion

## API Endpoints

- `POST /api/clients/:clientId/sync-transactions` - Trigger manual sync
- The sync process:
  1. Retrieves all transaction updates using cursor-based pagination
  2. Processes `added`, `modified`, and `removed` arrays
  3. Saves transactions to database
  4. Updates cursor for next sync

## Best Practices Summary

✅ **DO:**
- Retrieve ALL pages before persisting
- Save cursor only after successful completion
- Handle `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` by restarting
- Use `plaidTransactionId` as unique identifier
- Use webhooks (`SYNC_UPDATES_AVAILABLE`) in production instead of polling

❌ **DON'T:**
- Persist transactions before all pages are retrieved
- Retry only the failed page on mutation errors
- Use manual duplicate checks that interfere with cursor system
- Save cursor before processing is complete
- Use date ranges with `/transactions/sync` (filter after retrieval if needed)

## References

- [Plaid Transactions Sync Migration Guide](https://plaid.com/docs/transactions/sync-migration-guide/)
- [Plaid Transactions Sync API Reference](https://plaid.com/docs/api/products/transactions/#transactionssync)
- [Plaid Pattern (Best Practice Example)](https://github.com/plaid/pattern)

