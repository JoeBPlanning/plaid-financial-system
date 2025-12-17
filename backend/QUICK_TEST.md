# Quick Cross-Client Safety Test

## Fastest Method: Browser DevTools

1. **Login as Client A** in your browser
2. **Open DevTools Console** (F12)
3. **Run this command** (replace `CLIENT_B_ID` with a different client's ID):

```javascript
// Quick test - should return 403
fetch('http://localhost:3001/api/clients/CLIENT_B_ID', {
  credentials: 'include'
})
.then(r => {
  console.log('Status:', r.status);
  return r.json();
})
.then(data => {
  if (r.status === 403) {
    console.log('✅ SECURE - Access denied correctly');
  } else {
    console.log('❌ SECURITY ISSUE - Got status:', r.status, data);
  }
});
```

**Expected**: Status `403` with message "Access denied: You can only access your own data"

---

## Automated Test Script

1. **Edit** `backend/test-cross-client-safety.js`:
   - Update `CLIENT_A_CREDENTIALS` (username/password)
   - Update `CLIENT_B_ID` (different client's ID)

2. **Run**:
   ```bash
   cd backend
   node test-cross-client-safety.js
   ```

3. **Check results**: All should show `✅ 403 (Correct)`

---

## If Test Fails

**STOP** - Do not deploy. Check:
- Route missing `ensureClientOwnership` middleware?
- Admin route not validating `req.params.clientId` against `req.user.clientId`?

See `CROSS_CLIENT_SAFETY_TEST.md` for detailed instructions.

