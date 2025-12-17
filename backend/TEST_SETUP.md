# Quick Test Setup Guide

## The Problem

You need **two different users** to test cross-client safety:
- **Client A**: The user you log in as
- **Client B**: A different user whose data you try to access

---

## Quick Setup (3 Steps)

### Step 1: Make sure your server is running

```bash
cd backend
npm start
# or
node server.js
```

### Step 2: Create test users

**Option A: Use the setup script (easiest)**
```bash
node setup-test-users.js
```

**Option B: Create manually via API**
```bash
# Create Client A
curl -X POST http://localhost:3001/api/force-create-test-user

# Create Client B (you'll need to create this manually or use register endpoint)
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser2",
    "password": "password123",
    "name": "Test User B",
    "email": "testuser2@example.com",
    "advisorId": "advisor_main"
  }'
```

**Option C: Use existing users**
- If you already have users in your database, just use their credentials
- Get a user's ID: `GET http://localhost:3001/api/debug/testuser` (if test user exists)

### Step 3: Update test script and run

1. **Edit** `test-cross-client-safety.js`:
   ```javascript
   const CLIENT_A_CREDENTIALS = {
     username: 'testuser',      // Your Client A username
     password: 'password123'     // Your Client A password
   };
   
   const CLIENT_B_ID = 'client_test_user_2';  // Client B's ID (different from Client A)
   ```

2. **Run the test**:
   ```bash
   node test-cross-client-safety.js
   ```

---

## How to Get Client IDs

### Method 1: From setup script output
The `setup-test-users.js` script will show you the Client IDs when it creates users.

### Method 2: From login response
When you log in, the response includes the `clientId`:
```json
{
  "success": true,
  "client": {
    "clientId": "client_1234567890_abc123",
    ...
  }
}
```

### Method 3: From database
Check your SQLite database:
```bash
sqlite3 database.sqlite "SELECT clientId, username FROM clients LIMIT 5;"
```

### Method 4: From debug endpoint (dev only)
```bash
curl http://localhost:3001/api/debug/testuser
```

---

## Common Issues

### ❌ "Login error: Error"
**Cause**: Server not running or wrong credentials

**Fix**:
1. Make sure server is running: `npm start` in backend directory
2. Check credentials match an existing user
3. Create test user: `curl -X POST http://localhost:3001/api/force-create-test-user`

### ❌ "Cannot connect to server"
**Cause**: Server not running or wrong API_BASE URL

**Fix**:
1. Start server: `cd backend && npm start`
2. Check API_BASE in test script matches your server URL

### ❌ "Client A ID matches Client B ID"
**Cause**: Using the same client ID for both

**Fix**: Make sure CLIENT_B_ID is different from Client A's ID

---

## Example: Full Test Run

```bash
# Terminal 1: Start server
cd backend
npm start

# Terminal 2: Setup and run test
cd backend

# Create test users
node setup-test-users.js

# Update test-cross-client-safety.js with the shown credentials

# Run test
node test-cross-client-safety.js
```

---

## What You Need

✅ **Two different users** (Client A and Client B)
- Client A: username/password to log in
- Client B: clientId to try accessing

✅ **Server running** on the correct port (default: 3001)

✅ **Updated test script** with correct credentials and Client B ID

---

## Quick Check: Do I have users?

```bash
# Check if test user exists
curl http://localhost:3001/api/debug/testuser

# Or check database directly
sqlite3 database.sqlite "SELECT clientId, username FROM clients;"
```

If you see users, you can use their credentials and IDs in the test script!

