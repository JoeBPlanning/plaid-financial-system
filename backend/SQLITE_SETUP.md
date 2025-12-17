# SQLite Database Setup

Your application now uses **SQLite** instead of MongoDB. SQLite is a file-based database that stores everything in a single file on your computer.

## Database Location

The database file is located at:
```
backend/plaid-financial-system.db
```

This is a single file that contains all your data (clients, transactions, accounts, etc.).

## Viewing Your Database

### Option 1: SQLite Browser (Recommended - GUI)

1. **Download DB Browser for SQLite** (free):
   - macOS: https://sqlitebrowser.org/dl/
   - Or install via Homebrew: `brew install --cask db-browser-for-sqlite`

2. **Open the database file**:
   - Launch DB Browser for SQLite
   - Click "Open Database"
   - Navigate to `backend/plaid-financial-system.db`
   - Click "Open"

3. **Browse your data**:
   - Click on the "Browse Data" tab
   - Select a table from the dropdown (clients, transactions, monthly_summaries, plaid_access_tokens)
   - View all your data in a table format

### Option 2: Command Line (sqlite3)

If you have `sqlite3` installed (comes with macOS):

```bash
cd backend
sqlite3 plaid-financial-system.db
```

Then run SQL commands:
```sql
-- List all tables
.tables

-- View all clients
SELECT * FROM clients;

-- View clients with their Plaid connections
SELECT c.*, p.institutionName, p.accountIds 
FROM clients c 
LEFT JOIN plaid_access_tokens p ON c.clientId = p.clientId;

-- View transactions
SELECT * FROM transactions LIMIT 10;

-- View monthly summaries
SELECT * FROM monthly_summaries;
```

### Option 3: VS Code Extension

Install the "SQLite Viewer" extension in VS Code:
1. Open VS Code
2. Go to Extensions
3. Search for "SQLite Viewer"
4. Install it
5. Right-click on `plaid-financial-system.db` and select "Open Database"

## Database Schema

### Tables

1. **clients** - Stores client information (username, password, email, etc.)
2. **plaid_access_tokens** - Stores Plaid bank connections for each client
3. **transactions** - Stores all transactions from Plaid
4. **monthly_summaries** - Stores monthly financial summaries

## Viewing Client Data

To see a specific client's username, password, and accounts:

```sql
-- View all clients
SELECT clientId, username, password, name, email FROM clients;

-- View a specific client with their bank accounts
SELECT 
  c.clientId,
  c.username,
  c.password,
  c.name,
  c.email,
  p.institutionName,
  p.accountIds,
  p.isActive
FROM clients c
LEFT JOIN plaid_access_tokens p ON c.clientId = p.clientId
WHERE c.username = 'testuser';
```

## Backup Your Database

To backup your database, simply copy the file:
```bash
cp backend/plaid-financial-system.db backend/plaid-financial-system.db.backup
```

## Reset Database

To start fresh, delete the database file:
```bash
rm backend/plaid-financial-system.db
```

The database will be recreated automatically when you restart the server.

## Notes

- The database file is created automatically when you start the server
- All data persists between server restarts
- The file grows as you add more data
- You can move/copy the `.db` file to backup or transfer data
- No server setup required - it's just a file!

