# Plaid Production Environment Setup

## Summary of Changes

I've updated the codebase to properly support Plaid's production environment. The changes include:

1. **Created a centralized Plaid configuration utility** (`backend/utils/plaidConfig.js`)
   - Properly maps `PLAID_ENV` environment variable to PlaidEnvironments constants
   - Supports: `sandbox`, `development`, and `production`
   - Provides consistent Plaid client creation across all services

2. **Updated all Plaid client initializations** to use the new utility:
   - `backend/server.js`
   - `backend/utils/server.js`
   - `backend/services/transactionsSync.js`
   - `backend/services/investmentsSync.js`
   - `backend/services/balanceSheetSnapshot.js`
   - `backend/services/transactionProcessor.js`
   - `backend/scripts/update-transaction-account-info.js`

3. **Improved error handling** in the `/api/create_link_token` endpoint:
   - Validates Plaid credentials before attempting to create link token
   - Provides detailed error messages for debugging
   - Logs environment information for troubleshooting

## Required Configuration

To use Plaid's **production** environment, you need to set the following environment variables:

### On Render.com (Production Deployment)

1. Go to your Render.com dashboard → Your backend service → Environment
2. Set or update these variables:

```bash
PLAID_ENV=production
PLAID_CLIENT_ID=your_production_client_id
PLAID_SECRET=your_production_secret
```

**Important Notes:**
- `PLAID_ENV` must be set to exactly `production` (lowercase)
- You need **production** Plaid credentials from your Plaid dashboard
- Production credentials are different from sandbox/development credentials
- Make sure your Plaid app is approved for production use

### Local Development (.env.production file)

If you want to test production locally, update your `backend/.env.production` file:

```bash
PLAID_ENV=production
PLAID_CLIENT_ID=your_production_client_id
PLAID_SECRET=your_production_secret
NODE_ENV=production
# ... other variables
```

## Verifying the Configuration

After deploying, check the server logs. You should see:

```
🔧 Plaid Environment: production (basePath: https://production.plaid.com)
```

If you see `sandbox` instead, the `PLAID_ENV` variable is not set correctly.

## Troubleshooting

### Error: "Failed to create Plaid link token"

1. **Check environment variables:**
   - Verify `PLAID_ENV=production` is set
   - Verify `PLAID_CLIENT_ID` and `PLAID_SECRET` are set
   - Make sure credentials are for **production**, not sandbox

2. **Check Plaid Dashboard:**
   - Ensure your app is approved for production
   - Verify your production credentials are correct
   - Check if there are any API access restrictions

3. **Check server logs:**
   - Look for the detailed error messages we added
   - The logs will show which environment is being used
   - Check for credential validation errors

### Error: 401 Unauthorized

The 401 errors you're seeing are likely related to authentication middleware, not Plaid configuration. However, if Plaid credentials are missing or incorrect, you may also see 401 errors from Plaid's API.

## Plaid Environment Options

- **`sandbox`**: For testing with fake data (default if not set)
- **`development`**: For real banks but in development/testing mode
- **`production`**: For production use with real banks (requires approval)

## Next Steps

1. ✅ Code updated to support production environment
2. ⏳ Set `PLAID_ENV=production` in Render.com environment variables
3. ⏳ Add production Plaid credentials to Render.com
4. ⏳ Redeploy your backend service
5. ⏳ Test the "Connect your first bank account" button

The improved error logging will help diagnose any remaining issues after the environment is properly configured.
