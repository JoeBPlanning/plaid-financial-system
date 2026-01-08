# Production Setup Guide

This guide covers the production deployment setup for the Plaid Financial System.

## ✅ Completed Updates

### 1. Backend Database Migration to Supabase
- ✅ All models now use `models-supabase/` instead of `models-sqlite/`
- ✅ Database connection uses `database-supabase.js`
- ✅ All services updated:
  - `transactionsSync.js`
  - `investmentsSync.js`
  - `balanceSheetSnapshot.js`
  - `investmentSnapshot.js`
  - `transactionProcessor.js`

### 2. Plaid Token Encryption
- ✅ Plaid access tokens are encrypted before storing in Supabase
- ✅ Tokens are automatically decrypted when reading from database
- ✅ Encryption uses AES-256-GCM with authentication
- ✅ Encryption key stored in `ENCRYPTION_KEY` environment variable

### 3. Environment-Based Configuration
- ✅ Backend loads `.env.development` when `NODE_ENV=development`
- ✅ Backend loads `.env.production` when `NODE_ENV=production`
- ✅ Falls back to `.env` if environment-specific file doesn't exist

### 4. Frontend API Configuration
- ✅ Frontend uses `config.js` with environment variable support
- ✅ Development: `http://localhost:3001`
- ✅ Production: `https://plaid-financial-system-api.onrender.com`
- ✅ Can be overridden with `REACT_APP_API_BASE` environment variable

### 5. CORS Configuration
- ✅ Updated to allow production frontend URL
- ✅ Supports custom `FRONTEND_URL` from environment variables
- ✅ Includes localhost for development

## Environment Variables

### Backend (.env.production)

```bash
# Plaid Configuration
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_development_secret
PLAID_ENV=development  # Use 'development' for real banks, 'sandbox' for testing

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=your_32_byte_hex_key

# JWT Secret (generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_SECRET=your_jwt_secret

# Server Configuration
NODE_ENV=production
PORT=10000

# Frontend URL (optional, for CORS)
FRONTEND_URL=https://your-frontend-url.com
```

### Frontend (.env.production)

```bash
# API Base URL (optional - defaults based on NODE_ENV)
REACT_APP_API_BASE=https://plaid-financial-system-api.onrender.com
```

## Database Setup

### Supabase Migrations

All migrations should be run in Supabase SQL Editor:

1. `001_initial_schema.sql` - Core tables (clients, transactions, monthly_summaries, etc.)
2. `002_row_level_security.sql` - RLS policies
3. `003_documents_table.sql` - Documents table
4. `003_encryption_setup.sql` - Encryption functions (if needed)
5. `004_supabase_auth_setup.sql` - Auth integration
6. `005_invite_codes.sql` - Invite system
7. `006_social_security_data.sql` - Social Security data
8. `007_pdf_reports_extension.sql` - PDF reports

## Key Endpoints

### Authentication
- **POST** `/api/auth/login` - Not used (Supabase Auth handles this)
- **GET** `/api/auth/me` - Get current user info (requires auth)

### Plaid Integration
- **POST** `/api/create_link_token` - Create Plaid Link token (requires auth)
- **POST** `/api/exchange_public_token` - Exchange public token for access token (requires auth)
- **POST** `/api/clients/:clientId/plaid-token` - Store Plaid connection (requires auth)

### Transactions
- **GET** `/api/clients/:clientId/transactions` - Get transactions (requires auth)
- **POST** `/api/clients/:clientId/sync-transactions` - Sync from Plaid (requires auth)
- **POST** `/api/process-transactions/:clientId` - Process transactions into summary (requires auth)

## Security Features

### 1. Token Encryption
- Plaid access tokens are encrypted using AES-256-GCM
- Encryption key must be set in `ENCRYPTION_KEY` environment variable
- Tokens are automatically encrypted when stored
- Tokens are automatically decrypted when retrieved

### 2. Authentication
- Uses Supabase JWT tokens
- All protected routes require valid JWT in Authorization header
- Format: `Authorization: Bearer <token>`

### 3. Row Level Security (RLS)
- Supabase RLS policies ensure clients can only access their own data
- Backend uses service role key for admin operations
- Frontend uses anon key with user JWT tokens

### 4. CORS
- Configured to only allow requests from allowed origins
- Supports both development and production frontends

## Testing Endpoints

### 1. Health Check
```bash
curl https://plaid-financial-system-api.onrender.com/health
```

### 2. Create Link Token (requires auth)
```bash
curl -X POST https://plaid-financial-system-api.onrender.com/api/create_link_token \
  -H "Authorization: Bearer <supabase_jwt_token>" \
  -H "Content-Type: application/json"
```

### 3. Exchange Public Token (requires auth)
```bash
curl -X POST https://plaid-financial-system-api.onrender.com/api/exchange_public_token \
  -H "Authorization: Bearer <supabase_jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{"public_token": "public-sandbox-..."}'
```

### 4. Get Transactions (requires auth)
```bash
curl https://plaid-financial-system-api.onrender.com/api/clients/<client_id>/transactions?month=2024-01 \
  -H "Authorization: Bearer <supabase_jwt_token>"
```

## Deployment Checklist

- [ ] Set all environment variables in Render.com dashboard
- [ ] Generate and set `ENCRYPTION_KEY` (32 bytes hex)
- [ ] Generate and set `JWT_SECRET` (64 bytes hex)
- [ ] Verify Supabase migrations are run
- [ ] Test health endpoint
- [ ] Test authentication flow
- [ ] Test Plaid Link token creation
- [ ] Test bank connection flow
- [ ] Verify transactions are syncing
- [ ] Verify monthly summaries are generated
- [ ] Test frontend connection to production API

## Troubleshooting

### Plaid Token Errors
- Verify `ENCRYPTION_KEY` is set correctly
- Check that tokens are being encrypted/decrypted properly
- Verify Plaid credentials are correct

### Database Connection Issues
- Verify Supabase credentials are correct
- Check that migrations have been run
- Verify RLS policies are set up correctly

### CORS Errors
- Check that frontend URL is in allowed origins
- Verify `FRONTEND_URL` environment variable is set if using custom URL

### Authentication Errors
- Verify Supabase JWT tokens are being sent correctly
- Check that `Authorization: Bearer <token>` header is present
- Verify token hasn't expired
