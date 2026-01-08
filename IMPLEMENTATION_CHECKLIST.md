# Implementation Checklist - Production Setup

## ✅ Completed Items

### Frontend Configuration

- [x] **1. CREATE: frontend/src/config.js**
  - ✅ Created with `config.API_BASE` pattern
  - ✅ Uses `REACT_APP_API_BASE` environment variable
  - ✅ Defaults to `http://localhost:3001`

- [x] **2. CREATE: frontend/.env.development**
  - ✅ Created with `REACT_APP_API_BASE=http://localhost:3001`

- [x] **3. CREATE: frontend/.env.production**
  - ✅ Created with `REACT_APP_API_BASE=https://plaid-financial-system-api.onrender.com`

- [x] **4. UPDATE: frontend/src/App.js**
  - ✅ Changed from `import { API_BASE }` to `import config from './config'`
  - ✅ Uses `config.API_BASE` instead of hardcoded URL

- [x] **5. UPDATE: frontend/src/AdminDashboard.js**
  - ✅ Changed from `import { API_BASE }` to `import config from './config'`
  - ✅ Uses `config.API_BASE` instead of hardcoded URL

- [x] **6. UPDATE: frontend/src/TransactionReview.js**
  - ✅ Changed from `import { API_BASE }` to `import config from './config'`
  - ✅ Uses `config.API_BASE` instead of hardcoded URL

### Backend Configuration

- [x] **7. CREATE: backend/utils/encryption.js**
  - ✅ Created with AES-256-GCM encryption
  - ✅ Exports `encrypt`, `decrypt`, `encryptPlaidToken`, `decryptPlaidToken`
  - ✅ Validates 64-character hex key (32 bytes)

- [x] **8. UPDATE: backend/server.js**
  - ✅ Loads `.env.production` when `NODE_ENV=production`
  - ✅ Loads `.env.development` when `NODE_ENV=development` (or not set)
  - ✅ Environment loading happens at the very top of the file

- [x] **9. UPDATE: Plaid token exchange route**
  - ✅ Tokens are automatically encrypted via `Client` model
  - ✅ `encryptPlaidToken()` called before storing in database
  - ✅ Removed `access_token` from API response (security fix)

- [x] **10. UPDATE: Transaction fetch routes**
  - ✅ Tokens are automatically decrypted via `Client` model
  - ✅ `decryptPlaidToken()` called when reading from database
  - ✅ All API responses exclude `accessToken` from `plaidAccessTokens`

### Security Fixes

- [x] **11. Token exposure prevention**
  - ✅ Fixed `exchange_public_token` endpoint - removed token from response
  - ✅ Fixed `routes/clients.js` - excludes tokens from all client responses
  - ✅ Fixed admin client list endpoint - excludes tokens from responses

## 📋 Environment Variables Setup

### Backend Development (.env.development)

Create `backend/.env.development` with:

```bash
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_sandbox_secret
PLAID_ENV=sandbox
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=dev_secret_123
ENCRYPTION_KEY=generate_a_64_char_hex_key_for_dev
NODE_ENV=development
PORT=3001
```

**Generate keys:**
```bash
# JWT_SECRET (64 bytes)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# ENCRYPTION_KEY (32 bytes = 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Backend Production (.env.production)

Create `backend/.env.production` with:

```bash
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_development_secret
PLAID_ENV=development
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=generate_a_strong_random_string
ENCRYPTION_KEY=generate_a_different_64_char_hex_key_for_prod
NODE_ENV=production
PORT=10000
```

**⚠️ IMPORTANT:** Use DIFFERENT keys for production than development!

### Render.com Environment Variables

Add ALL variables from `.env.production` to:
- Render Dashboard → Your Service → Environment
- Set each variable individually
- Mark sensitive variables (JWT_SECRET, ENCRYPTION_KEY, SUPABASE_SERVICE_ROLE_KEY) as "Secret"

## 🔒 Security Checklist

- [ ] Generate unique `ENCRYPTION_KEY` for production (64 hex characters)
- [ ] Generate unique `JWT_SECRET` for production (128 hex characters)
- [ ] Verify `ENCRYPTION_KEY` is different between dev and prod
- [ ] Verify `JWT_SECRET` is different between dev and prod
- [ ] Add all environment variables to Render.com dashboard
- [ ] Mark sensitive variables as "Secret" in Render.com
- [ ] Verify `.env.*` files are in `.gitignore`
- [ ] Never commit actual keys to version control

## 🧪 Testing Checklist

### Local Development Testing

- [ ] Start backend: `cd backend && npm start` (should load `.env.development`)
- [ ] Start frontend: `cd frontend && npm start` (should load `.env.development`)
- [ ] Verify frontend connects to `http://localhost:3001`
- [ ] Test Plaid Link connection
- [ ] Verify token is encrypted in database
- [ ] Test transaction fetching (token should decrypt automatically)

### Production Testing

- [ ] Deploy backend to Render.com with all environment variables
- [ ] Verify backend loads `.env.production` (check logs)
- [ ] Build frontend: `cd frontend && npm run build` (should load `.env.production`)
- [ ] Deploy frontend
- [ ] Verify frontend connects to `https://plaid-financial-system-api.onrender.com`
- [ ] Test Plaid Link connection in production
- [ ] Verify token is encrypted in Supabase
- [ ] Test transaction fetching in production

## 📝 File Locations

### Created Files
- ✅ `frontend/src/config.js`
- ✅ `frontend/.env.development`
- ✅ `frontend/.env.production`
- ✅ `backend/utils/encryption.js`
- ✅ `backend/.env.development.example`
- ✅ `backend/.env.production.example`

### Updated Files
- ✅ `frontend/src/App.js`
- ✅ `frontend/src/AdminDashboard.js`
- ✅ `frontend/src/TransactionReview.js`
- ✅ `backend/server.js`
- ✅ `backend/models-supabase/Client.js` (encryption/decryption)
- ✅ `backend/routes/clients.js` (token exclusion)
- ✅ `backend/server.js` (token exclusion in admin routes)

## 🎯 Next Steps

1. **Create actual environment files:**
   ```bash
   cd backend
   cp .env.development.example .env.development
   cp .env.production.example .env.production
   # Edit both files with your actual values
   ```

2. **Generate encryption keys:**
   ```bash
   # Development encryption key
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # Production encryption key (DIFFERENT!)
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Add to Render.com:**
   - Go to Render Dashboard → Your Service → Environment
   - Add each variable from `.env.production`
   - Mark sensitive ones as "Secret"

4. **Test locally:**
   ```bash
   # Backend
   cd backend
   NODE_ENV=development npm start
   
   # Frontend (in another terminal)
   cd frontend
   npm start
   ```

5. **Deploy to production:**
   - Push code to repository
   - Render will auto-deploy
   - Verify environment variables are set
   - Test production endpoints

## ✅ Verification Commands

```bash
# Verify encryption utility exists
ls backend/utils/encryption.js

# Verify config files exist
ls frontend/src/config.js
ls frontend/.env.development
ls frontend/.env.production

# Verify environment loading in server.js
head -5 backend/server.js | grep -E "envFile|dotenv"

# Verify frontend uses config
grep -r "config.API_BASE" frontend/src/

# Verify encryption is used in Client model
grep -E "encryptPlaidToken|decryptPlaidToken" backend/models-supabase/Client.js
```

All implementation items are complete! 🎉
