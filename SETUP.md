# Setup Guide

## Starting the Servers

### Backend Server

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Start the server:
   ```bash
   node server.js
   ```
   
   Or with auto-reload (using nodemon):
   ```bash
   nodemon server.js
   ```

3. The backend server will run on **port 3001** (or the port specified in your `PORT` environment variable).

4. You should see:
   - `🚀 Server running on port 3001`
   - `📡 Visit: http://localhost:3001`

### Frontend Server

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Start the React development server:
   ```bash
   npm start
   ```

3. The frontend will automatically open in your browser at **http://localhost:3000**

## Test User Information

### Login Credentials

- **Username:** `testuser`
- **Password:** `password123`

### Test User Details

- **Client ID:** `client_test_user`
- **Name:** Test User
- **Email:** `test@example.com`
- **Advisor ID:** `advisor_main`

### Viewing Test User Information (JSON)

To see the test user account information in JSON format in your terminal, use one of these commands:

**Option 1: Using the debug endpoint (recommended)**
```bash
curl http://localhost:3001/api/debug/testuser | python3 -m json.tool
```

**Option 2: Using curl with jq (if installed)**
```bash
curl http://localhost:3001/api/debug/testuser | jq
```

**Option 3: Plain curl (raw JSON)**
```bash
curl http://localhost:3001/api/debug/testuser
```

**Option 4: Get all clients (admin endpoint)**
```bash
curl http://localhost:3001/api/admin/clients | python3 -m json.tool
```

> **Note:** Make sure your backend server is running before executing these commands.

### Creating the Test User

If the test user doesn't exist, you can create it by making a POST request to:

```bash
curl -X POST http://localhost:3001/api/auth/create-test-user
```

Or force create/recreate the test user:

```bash
curl -X POST http://localhost:3001/api/force-create-test-user
```

## Viewing Transaction Information (JSON)

To inspect transaction data in JSON format in your terminal, use these commands:

### Get ALL Stored Transactions (No Month Filter)

To see all transactions stored in the database (across all months):

```bash
curl "http://localhost:3001/api/clients/client_test_user/transactions?limit=1000" | python3 -m json.tool
```

This will return all stored transactions from the database, sorted by date (newest first).

### Get Transactions for Last 6 Months

To see transactions from the last 6 months:

```bash
curl "http://localhost:3001/api/clients/client_test_user/transactions?months=6&limit=1000" | python3 -m json.tool
```

Or for any number of months (e.g., last 12 months):

```bash
curl "http://localhost:3001/api/clients/client_test_user/transactions?months=12&limit=1000" | python3 -m json.tool
```

### Get Transactions for Test User (Current Month)

**Option 1: Admin endpoint (recommended)**
```bash
curl "http://localhost:3001/api/admin/transactions/client_test_user" | python3 -m json.tool
```

**Option 2: Client endpoint**
```bash
curl "http://localhost:3001/api/clients/client_test_user/transactions" | python3 -m json.tool
```

**Option 3: Legacy review endpoint**
```bash
curl "http://localhost:3001/api/review-transactions/client_test_user" | python3 -m json.tool
```

### Get Transactions for a Specific Month

Replace `YYYY-MM` with the desired month (e.g., `2025-10`):

**Admin endpoint:**
```bash
curl "http://localhost:3001/api/admin/transactions/client_test_user?month=2025-10" | python3 -m json.tool
```

**Client endpoint:**
```bash
curl "http://localhost:3001/api/clients/client_test_user/transactions?month=2025-10&limit=100" | python3 -m json.tool
```

### Get Monthly Summary

View the monthly financial summary for a specific month:

```bash
curl "http://localhost:3001/api/admin/summaries/client_test_user" | python3 -m json.tool
```

Or get summaries via client endpoint:

```bash
curl "http://localhost:3001/api/clients/client_test_user/summaries?limit=12" | python3 -m json.tool
```

### Using jq for Better Formatting

If you have `jq` installed, you can use it instead of `python3 -m json.tool`:

```bash
curl "http://localhost:3001/api/admin/transactions/client_test_user?month=2025-10" | jq
```

### Store Transactions for Multiple Months

If you're not seeing transactions, you may need to fetch and store them from Plaid. The sandbox data resets monthly, so you may need to reconnect or fetch fresh data.

**Store transactions for the last 3 months (default):**
```bash
curl -X POST "http://localhost:3001/api/clients/client_test_user/store-transactions" \
  -H "Content-Type: application/json" \
  -d '{"months": 3}' | python3 -m json.tool
```

**Store transactions for the entire year (12 months):**
```bash
curl -X POST "http://localhost:3001/api/clients/client_test_user/store-transactions" \
  -H "Content-Type: application/json" \
  -d '{"months": 12}' | python3 -m json.tool
```

**Store transactions for a specific number of months:**
```bash
curl -X POST "http://localhost:3001/api/clients/client_test_user/store-transactions" \
  -H "Content-Type: application/json" \
  -d '{"months": 6}' | python3 -m json.tool
```

> **Note:** This will fetch transactions from Plaid and store them in your database. Make sure you have an active Plaid connection (not a test/fake token).

### Refresh Transactions for a Specific Month

If you need to clear and refresh transactions for a specific month:

```bash
curl -X POST "http://localhost:3001/api/clients/client_test_user/refresh-transactions" \
  -H "Content-Type: application/json" \
  -d '{"month": "2025-10"}' | python3 -m json.tool
```

### Check Bank Connection Status

To see if your test user has active bank connections:

```bash
curl "http://localhost:3001/api/debug/testuser" | python3 -m json.tool | grep -A 20 "plaidAccessTokens"
```

Or view the full user object:
```bash
curl "http://localhost:3001/api/debug/testuser" | python3 -m json.tool
```

### Quick Reference

- **Test User Client ID:** `client_test_user`
- **Month Format:** `YYYY-MM` (e.g., `2025-10` for October 2025)
- **Default Month:** Current month if not specified
- **Default Limit:** 100 transactions (for client endpoint)
- **Sandbox Reset:** Plaid sandbox data resets monthly - you may need to reconnect or fetch fresh data

> **Important Notes:**
> - Make sure your backend server is running and the test user has connected bank accounts via Plaid to see transaction data
> - Test/fake access tokens (like `access-sandbox-test-token`) are automatically skipped
> - If you're not seeing transactions, try storing them first using the `store-transactions` endpoint
> - Sandbox data resets at the beginning of each month, so you may need to reconnect your account

## Troubleshooting: No Transactions Showing

### Check Plaid Connection Status

If you're not seeing transactions, first check if your Plaid connection is still valid:

```bash
curl "http://localhost:3001/api/accounts/access-sandbox-f01010cf-8f5e-4689-8510-8e5b902bc38e" | python3 -m json.tool
```

(Replace the access token with your actual token from the debug endpoint)

### Common Issues

**1. ITEM_LOGIN_REQUIRED Error**

If you see an error like:
```json
{
  "error_code": "ITEM_LOGIN_REQUIRED",
  "error_message": "the login details of this item have changed..."
}
```

This means your Plaid connection has expired and needs to be re-authenticated. You need to:
- Go to your frontend application
- Use Plaid Link to reconnect your bank account
- The system will update the access token automatically

**2. Empty Transactions Array**

If transactions return empty `[]`, possible causes:
- **Sandbox data reset**: Plaid sandbox resets monthly - reconnect through Plaid Link
- **No transactions in that month**: Try different months or check if the account has activity
- **Connection expired**: Reconnect through Plaid Link

**3. Reconnecting Your Bank Account**

To reconnect:
1. Open your frontend application (http://localhost:3000)
2. Log in as the test user
3. Navigate to the bank connection section
4. Use Plaid Link to reconnect your account
5. The new access token will be saved automatically

### Plaid Sandbox Test Credentials

When connecting to **First Platypus Bank** (or any Plaid sandbox institution), use these test credentials:

- **Username:** `user_good`
- **Password:** `pass_good`
- **2FA Code (if prompted):** `1234`

These are the standard Plaid sandbox credentials that work with all test institutions in the sandbox environment.

**Note:** These credentials only work in Plaid's sandbox environment. In production, you would use real bank credentials.

**4. Test Your Plaid Connection**

Check if Plaid is working:
```bash
curl "http://localhost:3001/api/test_plaid" | python3 -m json.tool
```

This will verify your Plaid credentials are configured correctly.

## Environment Variables

Make sure you have a `.env` file in the `backend` directory with:

- `PLAID_CLIENT_ID` - Your Plaid client ID
- `PLAID_SECRET` - Your Plaid secret key
- `PLAID_ENV` - Plaid environment (e.g., `sandbox`, `development`, `production`)
- `MONGODB_URI` - MongoDB connection string (optional)
- `PORT` - Server port (defaults to 3001 if not set)

## Quick Start Commands

**Terminal 1 - Backend:**
```bash
cd backend && node server.js
```

**Terminal 2 - Frontend:**
```bash
cd frontend && npm start
```

