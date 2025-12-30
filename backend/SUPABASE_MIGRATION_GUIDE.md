# Supabase Migration Guide

Complete guide to migrate from SQLite to Supabase (PostgreSQL) for the Plaid Financial System.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Database Setup](#database-setup)
4. [Running Migrations](#running-migrations)
5. [Configuring Authentication](#configuring-authentication)
6. [Updating Your Backend Code](#updating-your-backend-code)
7. [Testing the Migration](#testing-the-migration)
8. [Security Considerations](#security-considerations)

---

## Prerequisites

- Supabase account (sign up at [supabase.com](https://supabase.com))
- Node.js 16+ installed
- Existing Plaid Financial System backend

---

## Environment Variables

### 1. Create/Update `.env` file

Add these variables to your backend `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Optional: Encryption key for Plaid access tokens (32 bytes hex)
ENCRYPTION_KEY=generate-a-secure-32-byte-hex-key-here

# Your advisor ID (for RLS policies)
ADVISOR_ID=your-advisor-id-here

# Existing environment variables (keep these)
PLAID_CLIENT_ID=your-plaid-client-id
PLAID_SECRET=your-plaid-secret
PLAID_ENV=sandbox
JWT_SECRET=your-jwt-secret
PORT=3001
```

### 2. How to Get Supabase Credentials

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Once created, go to **Settings** → **API**
3. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon/public key** → `SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ Keep this secret!)

### 3. Generate Encryption Key

For encrypting Plaid access tokens at the application level:

```bash
# Run this in your terminal
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output to `ENCRYPTION_KEY` in your `.env` file.

---

## Database Setup

### Step 1: Access Supabase SQL Editor

1. Log into your Supabase dashboard
2. Navigate to **SQL Editor** in the left sidebar
3. Create a new query

### Step 2: Run Migration Scripts

Run these scripts **in order**:

#### 1. Initial Schema (001_initial_schema.sql)

```bash
# Copy the contents of backend/migrations/001_initial_schema.sql
# Paste into Supabase SQL Editor
# Click "Run" or press Cmd/Ctrl + Enter
```

This creates:
- ✅ All 8 tables (clients, plaid_connections, transactions, monthly_summaries, documents, investments, balance_sheets, investment_snapshots)
- ✅ Indexes for performance
- ✅ Foreign key relationships
- ✅ Triggers for auto-updating timestamps

#### 2. Row Level Security (002_row_level_security.sql)

```bash
# Copy the contents of backend/migrations/002_row_level_security.sql
# Paste into Supabase SQL Editor
# Click "Run"
```

This enables:
- ✅ RLS on all tables
- ✅ Client-level data isolation
- ✅ Advisor access to all client data
- ✅ Secure multi-tenant architecture

#### 3. Optional: Encryption Setup (003_encryption_setup.sql)

Read this file for:
- Database-level encryption using Supabase Vault (Pro plan only)
- Application-level encryption (works on all plans)

**Recommendation**: Start with application-level encryption, upgrade to Supabase Vault in production.

---

## Configuring Authentication

### Option 1: Using Supabase Auth (Recommended)

Supabase provides built-in authentication. To integrate:

1. **Enable Email/Password Auth**
   - Go to **Authentication** → **Providers**
   - Enable **Email** provider

2. **Set Up Custom Claims** (for advisor role)
   - Go to **SQL Editor**
   - Run this function to add advisor role to JWT:

```sql
-- Create function to add custom claims to JWT
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  claims jsonb;
  user_role text;
  user_advisor_id text;
BEGIN
  -- Get user metadata
  SELECT raw_user_meta_data->>'role' INTO user_role
  FROM auth.users
  WHERE id = (event->>'user_id')::uuid;

  SELECT raw_user_meta_data->>'advisor_id' INTO user_advisor_id
  FROM auth.users
  WHERE id = (event->>'user_id')::uuid;

  claims := event->'claims';

  -- Add custom claims
  IF user_role IS NOT NULL THEN
    claims := jsonb_set(claims, '{role}', to_jsonb(user_role));
  END IF;

  IF user_advisor_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{advisor_id}', to_jsonb(user_advisor_id));
  END IF;

  event := jsonb_set(event, '{claims}', claims);

  RETURN event;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO postgres;

-- Register the hook (Supabase Dashboard → Authentication → Hooks)
-- Set "custom_access_token_hook" to point to this function
```

3. **Create an Advisor User**
   - Go to **Authentication** → **Users**
   - Add a new user
   - In **User Metadata**, add:
     ```json
     {
       "role": "advisor",
       "advisor_id": "YOUR_ADVISOR_ID"
     }
     ```

### Option 2: Keep Your Existing JWT Auth

If you want to keep your current authentication system:

1. Modify RLS policies to work with your JWT structure
2. Update the `auth.jwt()` calls in `002_row_level_security.sql`
3. Pass your JWT token to Supabase client:

```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    global: {
      headers: {
        Authorization: `Bearer ${yourJwtToken}`
      }
    }
  }
);
```

---

## Updating Your Backend Code

### Step 1: Switch Database Import

In your route files and server.js, change from SQLite to Supabase:

**Before (SQLite):**
```javascript
const { initDatabase } = require('./database');
const Client = require('./models-sqlite/Client');
const Transaction = require('./models-sqlite/Transaction');
const MonthlySummary = require('./models-sqlite/MonthlySummary');
```

**After (Supabase):**
```javascript
const { initDatabase } = require('./database-supabase');
const Client = require('./models-supabase/Client');
const Transaction = require('./models-supabase/Transaction');
const MonthlySummary = require('./models-supabase/MonthlySummary');
const Investment = require('./models-supabase/Investment');
const BalanceSheet = require('./models-supabase/BalanceSheet');
const InvestmentSnapshot = require('./models-supabase/InvestmentSnapshot');
const Document = require('./models-supabase/Document');
```

### Step 2: Update Model Calls to Use Async/Await

Supabase models return Promises, so update your code:

**Before:**
```javascript
const client = Client.findOne({ email: 'test@example.com' });
```

**After:**
```javascript
const client = await Client.findOne({ email: 'test@example.com' });
```

**Important**: Make sure all route handlers are `async`:

```javascript
// Before
app.get('/api/clients/:id', (req, res) => {
  const client = Client.findOne({ clientId: req.params.id });
  res.json(client);
});

// After
app.get('/api/clients/:id', async (req, res) => {
  try {
    const client = await Client.findOne({ clientId: req.params.id });
    res.json(client);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database error' });
  }
});
```

### Step 3: Handle UUID vs Integer IDs

Supabase uses UUIDs for `client_id`. Update your code:

**Before (SQLite):**
```javascript
const clientId = 'client_' + Date.now();
```

**After (Supabase):**
```javascript
const { v4: uuidv4 } = require('uuid'); // npm install uuid
const clientId = uuidv4();
```

Or let Supabase generate it automatically:
```javascript
// Don't pass client_id, let the database auto-generate it
const client = await Client.create({
  name: 'John Doe',
  email: 'john@example.com',
  advisorId: 'YOUR_ADVISOR_ID'
  // client_id will be auto-generated
});
```

### Step 4: Optional - Add Encryption Helper

Create `backend/utils/encryption.js`:

```javascript
const crypto = require('crypto');

const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = { encrypt, decrypt };
```

Use it when storing Plaid tokens:
```javascript
const { encrypt, decrypt } = require('./utils/encryption');

// When storing
const encryptedToken = encrypt(plaidAccessToken);
await Client.addPlaidTokenToClient(clientId, {
  accessToken: encryptedToken,
  itemId: itemId,
  // ...
});

// When retrieving
const client = await Client.findOne({ clientId });
const plaidToken = decrypt(client.plaidAccessTokens[0].accessToken);
```

---

## Testing the Migration

### 1. Test Database Connection

Create `backend/test-supabase.js`:

```javascript
const { initDatabase, getDatabase } = require('./database-supabase');

async function testConnection() {
  try {
    console.log('Testing Supabase connection...');
    const supabase = initDatabase();

    const { data, error } = await supabase.from('clients').select('count');

    if (error) {
      console.error('❌ Connection failed:', error);
    } else {
      console.log('✅ Connection successful!');
      console.log('Clients table is accessible');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testConnection();
```

Run:
```bash
node backend/test-supabase.js
```

### 2. Create a Test Client

```javascript
const Client = require('./models-supabase/Client');
const { initDatabase } = require('./database-supabase');

async function createTestClient() {
  initDatabase();

  const client = await Client.create({
    name: 'Test Client',
    email: 'test@example.com',
    password: 'hashed_password_here',
    advisorId: process.env.ADVISOR_ID
  });

  console.log('Created client:', client);
}

createTestClient();
```

### 3. Test RLS Policies

1. Create a client using service role (should work)
2. Try to access another client's data with a client JWT (should fail)
3. Access data with advisor JWT (should work for all clients)

---

## Security Considerations

### 1. Protect Your Service Role Key

⚠️ **NEVER** expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code or commit it to Git.

- ✅ Only use in backend server
- ✅ Add to `.gitignore`
- ✅ Store in environment variables

### 2. Use Anon Key for Client Requests

- Frontend should use `SUPABASE_ANON_KEY` with user JWT
- Backend uses `SUPABASE_SERVICE_ROLE_KEY` for admin operations

### 3. Encrypt Sensitive Data

- Plaid access tokens should be encrypted
- Use application-level encryption initially
- Upgrade to Supabase Vault in production

### 4. Enable SSL Only

In production:
```javascript
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false
  },
  global: {
    fetch: (url, options) => {
      // Force HTTPS
      if (!url.startsWith('https://')) {
        throw new Error('Only HTTPS connections allowed');
      }
      return fetch(url, options);
    }
  }
});
```

### 5. Regular Security Audits

- Review RLS policies quarterly
- Rotate encryption keys annually
- Monitor Supabase logs for suspicious activity

---

## Migration Checklist

- [ ] Created Supabase project
- [ ] Added environment variables to `.env`
- [ ] Ran 001_initial_schema.sql
- [ ] Ran 002_row_level_security.sql
- [ ] Configured authentication (Supabase Auth or custom JWT)
- [ ] Installed `@supabase/supabase-js` package
- [ ] Updated imports to use `models-supabase`
- [ ] Added `async/await` to all database calls
- [ ] Tested database connection
- [ ] Created test client
- [ ] Verified RLS policies work
- [ ] Encrypted Plaid tokens
- [ ] Tested transaction sync
- [ ] Tested monthly summaries
- [ ] Updated frontend API calls (if needed)
- [ ] Deployed and tested in production

---

## Rollback Plan

If you need to rollback to SQLite:

1. Change imports back to `./database` and `./models-sqlite/`
2. Restart server
3. Your SQLite database file is still intact

**Note**: Data won't sync between SQLite and Supabase automatically. Consider:
- Exporting SQLite data before migration
- Importing into Supabase using migration script
- Keep both running temporarily during transition

---

## Need Help?

- Supabase Docs: https://supabase.com/docs
- Supabase Discord: https://discord.supabase.com
- Plaid API Docs: https://plaid.com/docs

---

## Next Steps

1. Set up Supabase Storage for PDF documents
2. Configure real-time subscriptions for live data updates
3. Set up database backups
4. Configure staging environment
5. Set up monitoring and alerting
