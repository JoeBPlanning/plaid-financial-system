# Cross-Client Safety Test Guide

This document explains how to verify that Client A cannot access Client B's data.

## ✅ Test Requirements

1. **Log in as Client A** - Get a valid session cookie
2. **Try to fetch Client B data** - Use Client B's ID in the URL
3. **Must return 403** - All requests should be blocked with "Access denied"

---

## Method 1: Automated Test Script

### Prerequisites

1. Make sure you have at least 2 clients in your database
2. Know the credentials for Client A
3. Know the `clientId` for Client B

### Steps

1. **Update the test script** with your test data:
   ```bash
   # Edit backend/test-cross-client-safety.js
   # Update CLIENT_A_CREDENTIALS and CLIENT_B_ID
   ```

2. **Run the test script**:
   ```bash
   cd backend
   node test-cross-client-safety.js
   ```

3. **Check the results**:
   - ✅ All routes should return `403 Forbidden`
   - ❌ If any route returns `200` or allows access, that's a security issue!

---

## Method 2: Manual Browser Test (Chrome DevTools)

### Step 1: Get Client IDs

First, you need to know two different client IDs. You can:
- Check your database
- Use the debug endpoint (development only): `GET /api/debug/testuser`
- Create test users via: `POST /api/debug/create-test-user`

### Step 2: Login as Client A

1. Open your browser and navigate to your frontend login page
2. Open Chrome DevTools (F12)
3. Go to **Network** tab
4. Log in as Client A
5. In the login response, check **Application → Cookies** tab
6. Verify you have a `session` cookie (HttpOnly, Secure)

### Step 3: Test Cross-Client Access

1. Stay logged in as Client A
2. Open **Console** tab in DevTools
3. Run these test commands (replace `CLIENT_B_ID` with actual Client B's ID):

```javascript
// Test 1: Try to get Client B's profile
fetch('http://localhost:3001/api/clients/CLIENT_B_ID', {
  credentials: 'include'
})
.then(r => r.json())
.then(data => console.log('Status:', data))
.catch(e => console.error('Error:', e));

// Test 2: Try to get Client B's transactions
fetch('http://localhost:3001/api/clients/CLIENT_B_ID/transactions', {
  credentials: 'include'
})
.then(r => r.json())
.then(data => console.log('Status:', data))
.catch(e => console.error('Error:', e));

// Test 3: Try to get Client B's investments
fetch('http://localhost:3001/api/clients/CLIENT_B_ID/investments', {
  credentials: 'include'
})
.then(r => r.json())
.then(data => console.log('Status:', data))
.catch(e => console.error('Error:', e));

// Test 4: Try admin route with Client B's ID
fetch('http://localhost:3001/api/admin/transactions/CLIENT_B_ID', {
  credentials: 'include'
})
.then(r => r.json())
.then(data => console.log('Status:', data))
.catch(e => console.error('Error:', e));
```

### Expected Results

All requests should return:
```json
{
  "success": false,
  "error": "Access denied: You can only access your own data"
}
```

With HTTP status code: **403 Forbidden**

---

## Method 3: cURL Test

### Step 1: Login and Save Cookie

```bash
# Login as Client A and save cookies to file
curl -c cookies.txt -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"CLIENT_A_USERNAME","password":"CLIENT_A_PASSWORD"}'
```

### Step 2: Test Routes with Client B's ID

```bash
# Test 1: Get Client B's profile (should return 403)
curl -b cookies.txt http://localhost:3001/api/clients/CLIENT_B_ID

# Test 2: Get Client B's transactions (should return 403)
curl -b cookies.txt http://localhost:3001/api/clients/CLIENT_B_ID/transactions

# Test 3: Get Client B's investments (should return 403)
curl -b cookies.txt http://localhost:3001/api/clients/CLIENT_B_ID/investments

# Test 4: Admin route with Client B's ID (should return 403)
curl -b cookies.txt http://localhost:3001/api/admin/transactions/CLIENT_B_ID
```

### Expected Response

All should return:
```json
{
  "success": false,
  "error": "Access denied: You can only access your own data"
}
```

HTTP Status: `403 Forbidden`

---

## Routes to Test

The following routes should all return 403 when accessing another client's data:

### Client Routes (use `ensureClientOwnership`)
- `GET /api/clients/:clientId`
- `GET /api/clients/:clientId/transactions`
- `GET /api/clients/:clientId/investments`
- `GET /api/clients/:clientId/balance-sheets`
- `GET /api/clients/:clientId/investment-snapshots`
- `GET /api/clients/:clientId/summaries`
- `POST /api/clients/:clientId/update-transaction-categories`
- `POST /api/clients/:clientId/refresh-transactions`
- `POST /api/clients/:clientId/sync-transactions`
- `POST /api/clients/:clientId/sync-investments`
- `POST /api/clients/:clientId/balance-sheet-snapshot`
- `POST /api/clients/:clientId/investment-snapshot`
- `PUT /api/clients/:clientId/profile`
- `POST /api/clients/:clientId/plaid-token`

### Admin Routes (manual validation)
- `GET /api/admin/transactions/:clientId`
- `GET /api/admin/summaries/:clientId`
- `POST /api/admin/save-categories/:clientId`
- `POST /api/admin/regenerate-summary/:clientId`

### Other Routes
- `POST /api/process-transactions/:clientId`
- `GET /api/review-transactions/:clientId`
- `POST /api/save-categorized-transactions/:clientId`

---

## What to Look For

### ✅ PASS (Secure)
- HTTP Status: `403 Forbidden`
- Response: `{ "success": false, "error": "Access denied: You can only access your own data" }`

### ❌ FAIL (Security Issue!)
- HTTP Status: `200 OK` or `201 Created`
- Response contains Client B's data
- **ACTION REQUIRED**: Fix the route immediately!

### ⚠️ WARNING (Needs Investigation)
- HTTP Status: `404 Not Found` - Might be OK if resource doesn't exist, but verify
- HTTP Status: `401 Unauthorized` - Should not happen if you're logged in, investigate

---

## If Test Fails

1. **Stop immediately** - Do not deploy if this test fails
2. **Check the route** - Look for missing `ensureClientOwnership` middleware
3. **Check admin routes** - Verify they validate `req.params.clientId` against `req.user.clientId`
4. **Fix the route** - Add proper authorization checks
5. **Re-run the test** - Verify the fix works

---

## Quick Verification Checklist

- [ ] Logged in as Client A
- [ ] Have Client B's ID
- [ ] Tested at least 5 different routes
- [ ] All routes return 403 Forbidden
- [ ] No routes return 200 OK with Client B's data
- [ ] Verified both client routes and admin routes

---

## Example Test Results

### ✅ Good (Secure)
```
GET /api/clients/client_b_123 → 403 Forbidden
GET /api/clients/client_b_123/transactions → 403 Forbidden
GET /api/admin/transactions/client_b_123 → 403 Forbidden
```

### ❌ Bad (Security Issue!)
```
GET /api/clients/client_b_123 → 200 OK (returns Client B's data!)
GET /api/clients/client_b_123/transactions → 200 OK (returns Client B's transactions!)
```

If you see this, **STOP** and fix the routes before deploying!

