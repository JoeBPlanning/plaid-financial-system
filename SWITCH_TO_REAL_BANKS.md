# Switching from Sandbox to Real Banks (Development Mode)

## Overview

Plaid has three environments:
- **Sandbox** - Test with fake data (no real bank accounts)
- **Development** - Test with REAL bank accounts (free, limited transactions)
- **Production** - Full production access (requires approval)

To test with your actual bank account, you need to switch from **sandbox** to **development** mode.

### Recommended Environment File Setup

**Organize your environment files by purpose:**
- `backend/.env.development` → **Sandbox testing** (fake data, safe for testing)
- `backend/.env.production` → **Real banking** (your actual accounts, production deployment)

This keeps your real banking credentials separate from sandbox testing, making it easier to switch between modes.

---

## Step 1: Get Your Development Credentials

1. Go to [Plaid Dashboard](https://dashboard.plaid.com/)
2. Log in to your account
3. Navigate to **Team Settings** → **Keys**
4. Find your **Development** credentials:
   - **Client ID** (same for all environments)
   - **Development Secret** (different from sandbox secret)

---

## Step 2: Update Environment Files

### Recommended Setup: Use `.env.production` for Real Banking

**Keep your environment files organized:**
- `backend/.env.development` → Sandbox testing (fake data)
- `backend/.env.production` → Real banking (your actual accounts)

### Update `backend/.env.production`:

```bash
# Change from:
PLAID_ENV=sandbox
PLAID_SECRET=your_sandbox_secret

# To:
PLAID_ENV=development
PLAID_SECRET=your_development_secret
```

**Full `.env.production` should look like:**
```bash
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_development_secret  # ← Use DEVELOPMENT secret
PLAID_ENV=development                  # ← Changed from 'sandbox'
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=generate_a_strong_random_string
ENCRYPTION_KEY=your_64_char_hex_key
NODE_ENV=production
PORT=10000
```

### Keep `backend/.env.development` for Sandbox:

```bash
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_sandbox_secret      # ← Keep SANDBOX secret
PLAID_ENV=sandbox                      # ← Keep as 'sandbox'
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=dev_secret_123
ENCRYPTION_KEY=your_64_char_hex_key
NODE_ENV=development
PORT=3001
```

---

## Step 3: Update Production Environment (Render.com)

### Option A: Update via Render Dashboard

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select your backend service
3. Go to **Environment** tab
4. Update these variables:
   - `PLAID_ENV` → Change from `sandbox` to `development`
   - `PLAID_SECRET` → Change to your **Development Secret** (not sandbox secret)

### Option B: Update `backend/.env.production` and redeploy

**Note:** If you're using Render's environment variables (recommended), update them in the dashboard instead of the file. The `.env.production` file is mainly for reference.

If you do update the file:
```bash
# Change from:
PLAID_ENV=sandbox
PLAID_SECRET=your_sandbox_secret

# To:
PLAID_ENV=development
PLAID_SECRET=your_development_secret
```

Then commit and push:
```bash
git add backend/.env.production
git commit -m "Switch to Plaid development mode for real banks"
git push
```

**Important:** Make sure your Render.com environment variables match your `.env.production` file.

---

## Step 4: Verify the Change

### Check Backend Logs

After starting your backend, check the logs. You should see:
```
📁 Loading environment from: .env.production
🔧 Environment: development
🔑 Plaid Client ID: ✅ Found
🔐 Plaid Secret: ✅ Found
```

This confirms:
- ✅ The correct environment file is loaded (`.env.production`)
- ✅ Plaid is set to development mode (real banks)
- ✅ All credentials are present

### Check Health Endpoint

For production (Render.com):
```bash
curl https://plaid-financial-system-api.onrender.com/health
```

For local:
```bash
curl http://localhost:3001/health
```

Should return:
```json
{
  "status": "Server is healthy",
  "plaid_env": "development",
  ...
}
```

---

## Step 5: Test with Your Real Bank Account

### Option A: Use npm Script (Recommended)

1. **Start your backend with real banking:**
   ```bash
   cd backend
   npm run start:real-banking
   ```
   This uses `.env.production` for real banking credentials.

2. **Start your frontend:**
   ```bash
   cd frontend
   npm start
   ```

3. **Create/Login to your account** (if you haven't already)

4. **Click "Connect Bank Account"**

5. **In Plaid Link:**
   - You'll now see REAL banks (not just test banks)
   - Search for your actual bank
   - Log in with your real credentials
   - Select your accounts to connect

6. **After connecting:**
   - Your real transactions will sync
   - Real account balances will be fetched
   - Real investment data will be available

### Option B: Manual Override

```bash
cd backend
ENV_FILE=.env.production node server.js
```

### Available npm Scripts

```bash
# Sandbox testing (uses .env.development)
npm run start:dev

# Real banking (uses .env.production)
npm run start:real-banking

# Production mode (uses .env.production with NODE_ENV=production)
npm run start:prod
```

---

## Important Notes

### Development Mode Limitations

- **Free tier**: Limited to 100 live items (bank connections)
- **Transaction history**: Usually 30 days of history
- **Rate limits**: More restrictive than production
- **Perfect for testing**: Use this to test with your own accounts before going to production

### Security Reminders

- ✅ **Development mode uses REAL bank credentials** - be careful!
- ✅ **Tokens are encrypted** - your access tokens are encrypted in the database
- ✅ **HTTPS required** - Plaid requires HTTPS for development mode (Render provides this)
- ✅ **Never commit secrets** - keep your `.env` files out of git

### Differences: Sandbox vs Development

| Feature | Sandbox | Development |
|---------|---------|-------------|
| Banks | Fake test banks | Real banks |
| Data | Fake transactions | Real transactions |
| Credentials | Test credentials | Real bank login |
| Cost | Free | Free (limited) |
| Use Case | Initial testing | Testing with real data |

---

## Troubleshooting

### Error: "Invalid client_id or secret"

- **Solution**: Make sure you're using the **Development Secret** (not sandbox secret)
- Check your Plaid Dashboard → Keys → Development section

### Error: "Environment mismatch"

- **Solution**: Ensure `PLAID_ENV=development` matches the secret you're using
- Development secret only works with `PLAID_ENV=development`

### Can't see my bank in Plaid Link

- **Solution**: Make sure you're in development mode (not sandbox)
- Some banks may not be available in development mode
- Check [Plaid's supported institutions](https://plaid.com/institutions/)

### Transactions not syncing

- **Solution**: 
  1. Verify environment is set to `development`
  2. Check backend logs for Plaid API errors
  3. Ensure your bank connection is active in Plaid Dashboard

---

## Next Steps After Testing

Once you've tested with development mode and everything works:

1. **Apply for Production Access** (if needed):
   - Go to Plaid Dashboard → Settings
   - Request production access
   - Complete any required compliance steps

2. **Switch to Production Mode**:
   - Update `PLAID_ENV=production`
   - Use your production secret
   - Higher rate limits and full access

---

## Quick Reference

### Environment File Organization

| File | Purpose | PLAID_ENV | Use Case |
|------|---------|-----------|----------|
| `.env.development` | Sandbox testing | `sandbox` | Testing with fake data |
| `.env.production` | Real banking | `development` | Testing with your actual accounts |

### Sandbox Setup (`.env.development`)
```bash
PLAID_ENV=sandbox
PLAID_SECRET=sandbox_secret_xxxxx
NODE_ENV=development
PORT=3001
```

### Real Banking Setup (`.env.production`)
```bash
PLAID_ENV=development
PLAID_SECRET=development_secret_xxxxx
NODE_ENV=production
PORT=10000
```

### Running the Backend

```bash
# Sandbox testing (uses .env.development)
npm run start:dev

# Real banking (uses .env.production)
npm run start:real-banking

# Production mode (uses .env.production with NODE_ENV=production)
npm run start:prod
```

### Files to Update
- `backend/.env.production` (for real banking - update PLAID_ENV and PLAID_SECRET)
- `backend/.env.development` (keep for sandbox testing)
- Render.com Environment Variables (for production deployment - should match `.env.production`)

---

## Verification Checklist

- [ ] Updated `PLAID_ENV` to `development` in `.env.production`
- [ ] Updated `PLAID_SECRET` to development secret in `.env.production`
- [ ] Kept `.env.development` with sandbox settings (for testing)
- [ ] Updated `PLAID_ENV` to `development` in Render.com dashboard
- [ ] Updated `PLAID_SECRET` to development secret in Render.com dashboard
- [ ] Started backend with `npm run start:real-banking` (or `ENV_FILE=.env.production node server.js`)
- [ ] Verified server logs show: `📁 Loading environment from: .env.production`
- [ ] Verified health endpoint shows `plaid_env: "development"`
- [ ] Tested Plaid Link shows real banks (not just test banks)
- [ ] Successfully connected a real bank account
- [ ] Verified real transactions are syncing

---

You're all set! You can now test with your actual bank accounts. 🎉
