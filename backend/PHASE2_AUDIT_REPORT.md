# Phase 2 Audit Report: Client Identifier Usage

## Executive Summary

This audit identifies all routes that:
- Read `clientId`, `client_user_id`, or similar identifiers from `req.body`, `req.params`, or `req.query`
- Access client-specific data (Plaid, transactions, accounts, profiles, reports)

**Total Routes Audited:** 45 routes
**Routes Using `req.params.clientId`:** 23 routes
**Routes Using `req.body` for client data:** 3 routes (all secure)
**Routes Using `req.query` for client data:** 0 routes
**Routes Accessing Client Data:** 45 routes

---

## Routes Using `req.params.clientId`

### ✅ SECURE: Routes with `ensureClientOwnership` Middleware

These routes properly validate `req.params.clientId` against `req.user.clientId` via middleware.

| Route | Method | clientId Source | Middleware | Data Accessed |
|-------|--------|----------------|------------|---------------|
| `/api/clients/:clientId` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Client profile |
| `/api/clients/:clientId/transactions` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/clients/:clientId/investments` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Investments |
| `/api/clients/:clientId/balance-sheets` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Balance sheets |
| `/api/clients/:clientId/investment-snapshots` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Investment snapshots |
| `/api/clients/:clientId/summaries` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Monthly summaries |
| `/api/clients/:clientId/update-transaction-categories` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/clients/:clientId/refresh-transactions` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/clients/:clientId/store-transactions` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/clients/:clientId/sync-transactions` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/clients/:clientId/sync-investments` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Investments |
| `/api/clients/:clientId/balance-sheet-snapshot` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Balance sheets |
| `/api/clients/:clientId/investment-snapshot` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Investment snapshots |
| `/api/clients/:clientId/profile` | PUT | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Client profile |
| `/api/clients/:clientId/plaid-token` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Plaid tokens |
| `/api/process-transactions/:clientId` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/review-transactions/:clientId` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/save-categorized-transactions/:clientId` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/test-connect-bank/:clientId` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Plaid tokens (dev only) |
| `/api/test-real-plaid/:clientId` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Plaid tokens (dev only) |

**Status:** ✅ All secure - `ensureClientOwnership` validates `req.params.clientId` against `req.user.clientId`

---

### ⚠️ MANUAL VALIDATION: Admin Routes with Manual Checks

These routes use `requireAuth` but manually validate `req.params.clientId` against `req.user.clientId` (no `ensureClientOwnership` middleware).

| Route | Method | clientId Source | Middleware | Validation | Data Accessed |
|-------|--------|----------------|------------|------------|---------------|
| `/api/admin/transactions/:clientId` | GET | `req.params.clientId` → manually validated against `req.user.clientId` | `requireAuth` | Manual check (lines 466-474) | Transactions |
| `/api/admin/summaries/:clientId` | GET | `req.params.clientId` → manually validated against `req.user.clientId` | `requireAuth` | Manual check (lines 528-536) | Monthly summaries |
| `/api/admin/save-categories/:clientId` | POST | `req.params.clientId` → manually validated against `req.user.clientId` | `requireAuth` | Manual check (lines 569-577) | Transactions |
| `/api/admin/regenerate-summary/:clientId` | POST | `req.params.clientId` → manually validated against `req.user.clientId` | `requireAuth` | Manual check (lines 623-631) | Monthly summaries |

**Status:** ⚠️ Secure but inconsistent - Consider using `ensureClientOwnership` middleware for consistency

**Validation Pattern:**
```javascript
const requestedClientId = req.params.clientId;
const authenticatedClientId = req.user.clientId;

if (requestedClientId !== authenticatedClientId) {
  return res.status(403).json({ 
    success: false, 
    error: 'Access denied: You can only access your own data' 
  });
}

// Then use req.user.clientId for business logic
const clientId = req.user.clientId;
```

---

## Routes Using `req.body` for Client Data

### ✅ SECURE: Routes Deriving clientId from JWT

| Route | Method | clientId Source | Middleware | Data Accessed |
|-------|--------|----------------|------------|---------------|
| `/api/create_link_token` | POST | `req.user.clientId` (from JWT) | `requireAuth` | Plaid link token creation |
| `/api/exchange_public_token` | POST | `req.user.clientId` (from JWT) | `requireAuth` | Plaid token exchange |
| `/api/clients/:clientId/plaid-token` | POST | `req.user.clientId` (from JWT) | `requireAuth`, `ensureClientOwnership` | Plaid token storage |

**Status:** ✅ All secure - No `clientId` read from `req.body`

**Note:** These routes use `client_user_id` in Plaid API calls, but it's derived from `req.user.clientId`, not from request body.

---

## Routes Using `req.query` for Client Data

### ✅ SECURE: No clientId in Query Parameters

**Status:** ✅ No routes read `clientId` from `req.query`

All query parameters are used for filtering (dates, months, limits) but not for client identification.

---

## Routes Accessing Client Data Without clientId Parameter

### ✅ SECURE: Routes Using JWT-Derived clientId

| Route | Method | clientId Source | Middleware | Data Accessed |
|-------|--------|----------------|------------|---------------|
| `/api/admin/clients` | GET | N/A (returns all clients) | `requireAuth` | All client profiles |
| `/api/admin/capture-all-balance-sheets` | POST | N/A (operates on all clients) | `requireAuth` | All client balance sheets |
| `/api/admin/capture-all-investment-snapshots` | POST | N/A (operates on all clients) | `requireAuth` | All client investment snapshots |

**Status:** ⚠️ **SECURITY CONCERN** - These routes access ALL clients' data

**Recommendation:** These should be restricted to admin users only. Currently, any authenticated user can access all clients' data.

---

## Routes Using `access_token` Parameter (Plaid Access Tokens)

### ⚠️ POTENTIAL SECURITY ISSUE: Access Token Routes

| Route | Method | Identifier Source | Middleware | Data Accessed | Security Issue |
|-------|--------|-------------------|------------|---------------|----------------|
| `/api/accounts/:access_token` | GET | `req.params.access_token` | `requireAuth` | Plaid accounts | ⚠️ No validation that token belongs to authenticated user |
| `/api/transactions/:access_token` | GET | `req.params.access_token` | `requireAuth` | Plaid transactions | ⚠️ No validation that token belongs to authenticated user |
| `/api/investments/:access_token` | GET | `req.params.access_token` | `requireAuth` | Plaid investments | ⚠️ No validation that token belongs to authenticated user |

**Status:** ⚠️ **SECURITY ISSUE** - These routes accept `access_token` from URL params but don't verify it belongs to the authenticated user

**Risk:** An authenticated user could potentially access another client's Plaid data by guessing or obtaining their access token.

**Recommendation:** 
1. Verify the `access_token` belongs to `req.user.clientId` before making Plaid API calls
2. Or remove these routes if not needed (they seem redundant with other routes)

---

## Routes in `routes/clients.js`

### ✅ SECURE: All Routes Properly Protected

| Route | Method | clientId Source | Middleware | Data Accessed |
|-------|--------|----------------|------------|---------------|
| `/api/clients` | POST | Generated (creates new client) | `requireAuth` | Client creation |
| `/api/clients/advisor/:advisorId` | GET | `req.params.advisorId` | `requireAuth` | Clients by advisor |
| `/api/clients/:clientId` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Client profile |
| `/api/clients/:clientId/plaid-token` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Plaid tokens |
| `/api/clients/:clientId/summaries` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Monthly summaries |
| `/api/clients/:clientId/summary/:month` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Monthly summary |
| `/api/clients/:clientId/summary` | POST | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Monthly summary |
| `/api/clients/:clientId/transactions/uncategorized` | GET | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transactions |
| `/api/clients/:clientId/transactions/:transactionId/category` | PUT | `req.params.clientId` → validated by `ensureClientOwnership` | `requireAuth`, `ensureClientOwnership` | Transaction category |

**Status:** ✅ All secure - All routes use `ensureClientOwnership` middleware

---

## Webhook Routes

### ✅ SECURE: Webhook Routes (No Authentication Required)

| Route | Method | clientId Source | Middleware | Data Accessed |
|-------|--------|----------------|------------|---------------|
| `/api/plaid/webhook` | POST | Derived from `item_id` in webhook payload | None (Plaid calls directly) | Transactions, investments |

**Status:** ✅ Secure - Webhooks are called by Plaid, not by clients. Signature verification is performed.

---

## Test/Debug Routes (Development Only)

| Route | Method | clientId Source | Middleware | Data Accessed | Production Status |
|-------|--------|----------------|------------|---------------|-------------------|
| `/api/test_plaid` | GET | Hardcoded test value | None | Plaid connection test | Disabled in production |
| `/api/auth/create-test-user` | POST | Generated | None | Client creation | Disabled in production |
| `/api/force-create-test-user` | POST | Generated | None | Client creation | Disabled in production |
| `/api/debug/testuser` | GET | Hardcoded `client_test_user` | None | Client profile | Disabled in production |

**Status:** ✅ Secure - All disabled in production

---

## Summary of Findings

### ✅ Secure Routes (38 routes)
- All routes using `req.params.clientId` are properly validated
- All routes derive `clientId` from JWT when accessing client data
- No routes read `clientId` from `req.body` or `req.query`

### ⚠️ Routes Needing Attention (7 routes)

1. **Admin Routes (4 routes)** - Use manual validation instead of `ensureClientOwnership` middleware
   - Consider standardizing on `ensureClientOwnership` for consistency

2. **Access Token Routes (3 routes)** - Don't validate that `access_token` belongs to authenticated user
   - `/api/accounts/:access_token`
   - `/api/transactions/:access_token`
   - `/api/investments/:access_token`
   - **Risk:** Users could access other clients' Plaid data with a valid access token

3. **Admin Data Access Routes (3 routes)** - Access ALL clients' data without admin role check
   - `/api/admin/clients`
   - `/api/admin/capture-all-balance-sheets`
   - `/api/admin/capture-all-investment-snapshots`
   - **Risk:** Any authenticated user can access all clients' data

---

## Recommendations

### High Priority

1. **Fix Access Token Routes** - Add validation to ensure `access_token` belongs to `req.user.clientId`
   ```javascript
   // Before making Plaid API call, verify:
   const client = await Client.findOne({ clientId: req.user.clientId });
   const hasToken = client.plaidAccessTokens.some(t => t.accessToken === req.params.access_token);
   if (!hasToken) {
     return res.status(403).json({ error: 'Access denied' });
   }
   ```

2. **Restrict Admin Routes** - Add admin role check to routes that access all clients
   ```javascript
   // Add admin check before accessing all clients
   if (req.user.role !== 'admin') {
     return res.status(403).json({ error: 'Admin access required' });
   }
   ```

### Medium Priority

3. **Standardize Admin Routes** - Use `ensureClientOwnership` middleware instead of manual validation for consistency

### Low Priority

4. **Consider Removing Access Token Routes** - If redundant with other routes, consider removing them

---

## Code Patterns Found

### ✅ Good Pattern: Using `ensureClientOwnership`
```javascript
app.get('/api/clients/:clientId', requireAuth, ensureClientOwnership, async (req, res) => {
  const clientId = req.user.clientId; // ✅ Derived from JWT
  // ... access client data
});
```

### ⚠️ Acceptable Pattern: Manual Validation
```javascript
app.get('/api/admin/transactions/:clientId', requireAuth, async (req, res) => {
  const requestedClientId = req.params.clientId;
  if (requestedClientId !== req.user.clientId) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const clientId = req.user.clientId; // ✅ Derived from JWT after validation
  // ... access client data
});
```

### ❌ Bad Pattern: No Validation (Found in access_token routes)
```javascript
app.get('/api/accounts/:access_token', requireAuth, async (req, res) => {
  // ❌ No validation that access_token belongs to req.user.clientId
  const response = await plaidClient.accountsGet({
    access_token: req.params.access_token
  });
});
```

---

## Conclusion

**Overall Security Status:** ✅ **Mostly Secure**

- ✅ No `clientId` read from `req.body` or `req.query`
- ✅ All `req.params.clientId` routes are validated
- ⚠️ 3 routes need access token validation
- ⚠️ 3 admin routes need role-based access control
- ⚠️ 4 admin routes could use standardized middleware

**Next Steps:** Address the 3 access token routes and 3 admin data access routes before production deployment.

