# Client Recovery Guide

If you've lost access to your client, here are several ways to recover it:

## Option 1: Check if Client Exists

Run the recovery script to check client status:
```bash
cd backend
node scripts/recover-client.js
```

Or view all client data:
```bash
node scripts/view-client-data.js
```

## Option 2: Recreate Test Client

If the client is truly missing, you can recreate it using the API:

### Using curl:
```bash
curl -X POST http://localhost:3001/api/force-create-test-user
```

### Using the API directly:
- Endpoint: `POST /api/force-create-test-user`
- This will delete any existing test user and create a fresh one

## Option 3: Create Test Client (if it doesn't exist)

If the client doesn't exist, create it:
```bash
curl -X POST http://localhost:3001/api/auth/create-test-user
```

## Option 4: Manual Database Recovery

If you need to manually restore client data:

1. **Check what's in the database:**
```bash
sqlite3 plaid-financial-system.db "SELECT * FROM clients;"
```

2. **Check Plaid connections:**
```bash
sqlite3 plaid-financial-system.db "SELECT * FROM plaid_access_tokens WHERE clientId = 'client_test_user';"
```

3. **Check transactions:**
```bash
sqlite3 plaid-financial-system.db "SELECT COUNT(*) FROM transactions WHERE clientId = 'client_test_user';"
```

## Default Test Client Credentials

- **Client ID:** `client_test_user`
- **Username:** `testuser`
- **Password:** `password123`
- **Email:** `test@example.com`

## Troubleshooting

### Client exists but can't log in:
1. Verify the password is correct: `password123`
2. Check if the client is active: `isActive = 1`
3. Restart the backend server

### Client missing from frontend:
1. Check browser console for API errors
2. Verify backend is running on correct port
3. Check CORS settings if accessing from different origin
4. Clear browser cache and cookies

### Lost Plaid connections:
If you've lost Plaid connections but the client exists:
1. You'll need to reconnect through Plaid Link
2. The old access tokens may be invalid
3. Use the `/api/exchange_public_token` endpoint to add new connections

## Scripts Available

- `backend/scripts/recover-client.js` - Check client status
- `backend/scripts/view-client-data.js` - View all client data
- `backend/scripts/remove-duplicate-transactions.js` - Clean up duplicates
- `backend/scripts/analyze-duplicates.js` - Analyze for duplicates

