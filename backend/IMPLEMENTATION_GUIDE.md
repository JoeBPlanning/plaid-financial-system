# Complete Supabase Auth Implementation Guide

This guide provides step-by-step instructions to migrate from username/password auth to Supabase Auth with full security.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Configure Supabase Auth](#step-1-configure-supabase-auth)
3. [Step 2: Run Database Migrations](#step-2-run-database-migrations)
4. [Step 3: Configure Environment Variables](#step-3-configure-environment-variables)
5. [Step 4: Update Backend Code](#step-4-update-backend-code)
6. [Step 5: Update Frontend Code](#step-5-update-frontend-code)
7. [Step 6: Encrypt Plaid Tokens](#step-6-encrypt-plaid-tokens)
8. [Step 7: Testing](#step-7-testing)
9. [Step 8: Migration Checklist](#step-8-migration-checklist)

---

## Prerequisites

✅ Supabase project created
✅ Database migrations 001-003 already run (from SUPABASE_MIGRATION_GUIDE.md)
✅ Node.js packages installed

---

## Step 1: Configure Supabase Auth

### 1.1 Enable Email/Password Authentication

1. Go to your Supabase Dashboard
2. Navigate to **Authentication** → **Providers**
3. Enable **Email** provider
4. Optional: Configure email templates (sign up confirmation, password reset, etc.)

### 1.2 Configure Email Settings (Production)

For production, configure an SMTP provider:

1. Go to **Authentication** → **Settings**
2. Scroll to **SMTP Settings**
3. Add your SMTP credentials (SendGrid, AWS SES, Mailgun, etc.)
4. Test email delivery

### 1.3 Configure Site URL and Redirect URLs

1. Go to **Authentication** → **URL Configuration**
2. Set **Site URL**: `https://your-production-domain.com` (or `http://localhost:3000` for development)
3. Add **Redirect URLs**:
   - `http://localhost:3000/auth/callback` (development)
   - `https://your-production-domain.com/auth/callback` (production)

### 1.4 Configure JWT Expiry (Optional)

1. Go to **Authentication** → **Settings**
2. Set **JWT Expiry**: `604800` (7 days) or your preference

---

## Step 2: Run Database Migrations

### 2.1 Run Auth Setup Migration

In Supabase SQL Editor, run:

```sql
-- Copy and paste: backend/migrations/004_supabase_auth_setup.sql
```

This migration:
- ✅ Links Supabase Auth to clients table
- ✅ Auto-creates client record on signup
- ✅ Updates RLS policies to use `auth.uid()`
- ✅ Adds helper functions for role checking

### 2.2 Verify Migration

Run this query to verify:

```sql
-- Check if trigger exists
SELECT trigger_name
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Check if functions exist
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('handle_new_user', 'get_user_role', 'is_advisor');
```

---

## Step 3: Configure Environment Variables

### 3.1 Backend Environment Variables

Update your `backend/.env`:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here-KEEP-SECRET

# Encryption Key for Plaid Tokens
ENCRYPTION_KEY=generate-with-command-below

# Existing Variables (keep these)
PLAID_CLIENT_ID=your-plaid-client-id
PLAID_SECRET=your-plaid-secret
PLAID_ENV=sandbox
JWT_SECRET=your-jwt-secret
PORT=3001
NODE_ENV=development

# CORS (update with your frontend URL)
FRONTEND_URL=http://localhost:3000
```

### 3.2 Generate Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output to `ENCRYPTION_KEY` in `.env`

### 3.3 Frontend Environment Variables

Create/update `frontend/.env`:

```bash
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-public-key-here
REACT_APP_API_URL=http://localhost:3001
```

---

## Step 4: Update Backend Code

### 4.1 Install Supabase Package

```bash
cd backend
npm install @supabase/supabase-js
```

### 4.2 Update server.js - Option A: Replace Authentication

**Current (lines 10-16):**
```javascript
const { initDatabase } = require('./database');
initDatabase();

const Client = require('./models-sqlite/Client');
const Transaction = require('./models-sqlite/Transaction');
// ...
```

**New:**
```javascript
const { initDatabase } = require('./database-supabase');
initDatabase();

const Client = require('./models-supabase/Client');
const Transaction = require('./models-supabase/Transaction');
const MonthlySummary = require('./models-supabase/MonthlySummary');
const Investment = require('./models-supabase/Investment');
const BalanceSheet = require('./models-supabase/BalanceSheet');
const InvestmentSnapshot = require('./models-supabase/InvestmentSnapshot');
const Document = require('./models-supabase/Document');
```

### 4.3 Update Auth Middleware Import

**Current (line 32):**
```javascript
const { generateToken, requireAuth, ensureClientOwnership, requireAdmin } = require('./middleware/auth');
```

**New:**
```javascript
const { requireSupabaseAuth, ensureClientOwnership, requireAdvisor } = require('./middleware/supabase-auth');
```

### 4.4 Update CORS Configuration

**Current (lines 56-59):**
```javascript
app.use(cors({
  origin: ['http://localhost:3000', 'https://plaid-financial-system-api.onrender.com'],
  credentials: true
}));
```

**New:**
```javascript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  exposedHeaders: ['Authorization']
}));
```

### 4.5 Remove Old Auth Routes

**Delete these routes (lines 111-448):**
- `/api/auth/login`
- `/api/auth/logout`
- `/api/auth/register`
- `/api/auth/forgot-password`
- `/api/auth/create-test-user`
- `/api/force-create-test-user`
- `/api/debug/testuser`

These are replaced by Supabase Auth API calls from the frontend.

### 4.6 Update All Protected Routes

**Find and replace:**
- `requireAuth` → `requireSupabaseAuth`
- `requireAdmin` → `requireAdvisor`
- Keep `ensureClientOwnership` as is

**Example:**

**Before:**
```javascript
app.get('/api/clients/:clientId/transactions', requireAuth, ensureClientOwnership, async (req, res) => {
```

**After:**
```javascript
app.get('/api/clients/:clientId/transactions', requireSupabaseAuth, ensureClientOwnership, async (req, res) => {
```

### 4.7 Update clientId References

In routes, change from `req.user.clientId` to `req.user.id`:

**Before:**
```javascript
const clientId = req.user.clientId;
```

**After:**
```javascript
const clientId = req.user.id; // Supabase user UUID
```

### 4.8 Make All DB Calls Async

Since Supabase models return Promises:

**Before:**
```javascript
const client = Client.findOne({ clientId });
```

**After:**
```javascript
const client = await Client.findOne({ clientId });
```

**Make sure route handlers are `async`!**

---

## Step 5: Update Frontend Code

### 5.1 Install Supabase Package

```bash
cd frontend
npm install @supabase/supabase-js
```

### 5.2 Create Supabase Client

Create `frontend/src/lib/supabase.js`:

```javascript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### 5.3 Create Auth Context

Create `frontend/src/contexts/AuthContext.js`:

```javascript
import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email, password, userData = {}) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userData // user_metadata
      }
    });

    if (error) throw error;
    return data;
  };

  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const resetPassword = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    });

    if (error) throw error;
  };

  const value = {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    resetPassword
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
```

### 5.4 Create API Client with Auth Headers

Create `frontend/src/lib/api.js`:

```javascript
import axios from 'axios';
import { supabase } from './supabase';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true
});

// Add auth token to every request
api.interceptors.request.use(
  async (config) => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle 401 errors (token expired)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired, sign out
      await supabase.auth.signOut();
      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);

export default api;
```

### 5.5 Update App.js

Wrap your app with AuthProvider:

```javascript
import React from 'react';
import { AuthProvider } from './contexts/AuthContext';
import AppRoutes from './AppRoutes'; // Your routing component

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
```

### 5.6 Create Login Component

Create `frontend/src/components/Login.js`:

```javascript
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn(email, password);
      navigate('/dashboard'); // Redirect to dashboard
    } catch (error) {
      setError(error.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <h2>Login</h2>
      {error && <div className="error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

export default Login;
```

### 5.7 Create Signup Component

Create `frontend/src/components/Signup.js`:

```javascript
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      await signUp(email, password, {
        name, // Stored in user_metadata
        role: 'user', // Default role
        advisor_id: 'advisor_main' // Default advisor
      });

      setMessage('Check your email for verification link!');
      // Optional: auto-navigate to login after a delay
      setTimeout(() => navigate('/login'), 3000);
    } catch (error) {
      setError(error.message || 'Failed to sign up');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-container">
      <h2>Sign Up</h2>
      {error && <div className="error">{error}</div>}
      {message && <div className="success">{message}</div>}
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Full Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password (min 6 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Signing up...' : 'Sign Up'}
        </button>
      </form>
    </div>
  );
}

export default Signup;
```

### 5.8 Update API Calls

Replace all `axios` calls with the new `api` client:

**Before:**
```javascript
import axios from 'axios';

const response = await axios.get('/api/clients/123/transactions');
```

**After:**
```javascript
import api from '../lib/api';

const response = await api.get('/api/clients/123/transactions');
```

---

## Step 6: Encrypt Plaid Tokens

### 6.1 Update Plaid Token Storage

When saving Plaid access tokens, encrypt them:

**In your backend route that saves Plaid tokens:**

```javascript
const { encryptPlaidToken } = require('../utils/encryption');

// When storing Plaid token
const encryptedToken = encryptPlaidToken(plaidAccessToken);

await Client.addPlaidTokenToClient(clientId, {
  accessToken: encryptedToken, // Store encrypted
  itemId,
  institutionName,
  institutionId,
  accountIds,
  isActive: true
});
```

### 6.2 Update Plaid Token Retrieval

When using Plaid tokens, decrypt them:

```javascript
const { decryptPlaidToken } = require('../utils/encryption');

// When retrieving from database
const client = await Client.findOne({ clientId });
const plaidToken = decryptPlaidToken(client.plaidAccessTokens[0].accessToken);

// Use decrypted token with Plaid API
const response = await plaidClient.transactionsGet({
  access_token: plaidToken,
  // ...
});
```

### 6.3 Migrate Existing Tokens

Create a migration script `backend/scripts/migrate-encrypt-tokens.js`:

```javascript
const { initDatabase, getDatabase } = require('../database-supabase');
const { encryptPlaidToken, isEncrypted } = require('../utils/encryption');

async function migrateTokens() {
  initDatabase();
  const supabase = getDatabase();

  console.log('Starting token encryption migration...');

  // Get all plaid connections
  const { data: connections, error } = await supabase
    .from('plaid_connections')
    .select('*');

  if (error) {
    console.error('Error fetching connections:', error);
    return;
  }

  console.log(`Found ${connections.length} connections to encrypt`);

  for (const connection of connections) {
    // Skip if already encrypted
    if (isEncrypted(connection.access_token)) {
      console.log(`✓ Token ${connection.id} already encrypted`);
      continue;
    }

    // Encrypt the token
    const encryptedToken = encryptPlaidToken(connection.access_token);

    // Update in database
    const { error: updateError } = await supabase
      .from('plaid_connections')
      .update({ access_token: encryptedToken })
      .eq('id', connection.id);

    if (updateError) {
      console.error(`✗ Failed to encrypt token ${connection.id}:`, updateError);
    } else {
      console.log(`✓ Encrypted token ${connection.id}`);
    }
  }

  console.log('Migration complete!');
}

migrateTokens().catch(console.error);
```

Run it:
```bash
node backend/scripts/migrate-encrypt-tokens.js
```

---

## Step 7: Testing

### 7.1 Create Test User

1. Use your frontend signup form to create a test user
2. Check email for verification link (if email verification enabled)
3. Verify user appears in Supabase Auth dashboard
4. Verify client record was created in `clients` table

**Or use Supabase Dashboard:**
1. Go to **Authentication** → **Users**
2. Click **Add user**
3. Set email, password, and user metadata:
   ```json
   {
     "name": "Test User",
     "role": "user",
     "advisor_id": "advisor_main"
   }
   ```

### 7.2 Test Login

1. Use frontend login form
2. Verify redirect to dashboard
3. Check that JWT token is present in session
4. Verify API calls include `Authorization` header

### 7.3 Test RLS Policies

**As User:**
```javascript
// Should only return current user's data
const { data } = await supabase.from('transactions').select('*');
```

**As Advisor:**
1. Create advisor user with metadata: `{ "role": "advisor" }`
2. Should return all clients' data:
```javascript
const { data } = await supabase.from('transactions').select('*');
```

### 7.4 Test Encrypted Tokens

```javascript
const { encryptPlaidToken, decryptPlaidToken } = require('./utils/encryption');

const original = 'access-sandbox-test-token';
const encrypted = encryptPlaidToken(original);
const decrypted = decryptPlaidToken(encrypted);

console.log('Original:', original);
console.log('Encrypted:', encrypted);
console.log('Decrypted:', decrypted);
console.log('Match:', original === decrypted); // Should be true
```

---

## Step 8: Migration Checklist

### Backend
- [ ] Supabase package installed (`@supabase/supabase-js`)
- [ ] All migrations run (001 → 004)
- [ ] Environment variables configured (`.env`)
- [ ] Encryption key generated
- [ ] Database client updated (`database-supabase.js`)
- [ ] Models updated (`models-supabase/`)
- [ ] Auth middleware updated (`supabase-auth.js`)
- [ ] All routes use `requireSupabaseAuth`
- [ ] All routes are `async`
- [ ] All DB calls use `await`
- [ ] Plaid tokens encrypted on save
- [ ] Plaid tokens decrypted on use
- [ ] Old auth routes removed

### Frontend
- [ ] Supabase package installed
- [ ] Environment variables configured (`.env`)
- [ ] Supabase client created (`lib/supabase.js`)
- [ ] Auth context created (`contexts/AuthContext.js`)
- [ ] API client with auth headers (`lib/api.js`)
- [ ] App wrapped with `AuthProvider`
- [ ] Login component created
- [ ] Signup component created
- [ ] All API calls use authenticated client
- [ ] Protected routes check auth state

### Database
- [ ] Email provider enabled in Supabase
- [ ] RLS policies updated to use `auth.uid()`
- [ ] Trigger created to auto-create clients
- [ ] Helper functions created
- [ ] Test user created
- [ ] Test advisor created (with role metadata)

### Testing
- [ ] User signup works
- [ ] Email verification works (if enabled)
- [ ] User login works
- [ ] JWT token included in API requests
- [ ] RLS policies enforce user isolation
- [ ] Advisor can access all data
- [ ] Plaid token encryption works
- [ ] Plaid token decryption works
- [ ] Existing Plaid connections work

---

## Troubleshooting

### "Invalid or expired token"
- Check that `Authorization` header is set correctly
- Verify token hasn't expired (check JWT expiry settings)
- Ensure `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct

### "RLS policy violation"
- Verify user is authenticated (`auth.uid()` returns value)
- Check client_id matches auth.uid()
- For advisor access, verify user_metadata.role = 'advisor'

### "Encryption key not found"
- Generate key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Add to `.env` as `ENCRYPTION_KEY=...`

### "Client record not created on signup"
- Check trigger exists: `SELECT * FROM information_schema.triggers WHERE trigger_name = 'on_auth_user_created';`
- Check trigger function: `SELECT * FROM information_schema.routines WHERE routine_name = 'handle_new_user';`
- Manually create client if needed

---

## Next Steps

1. **Set up email verification** (recommended for production)
2. **Configure password reset** flow
3. **Add social login** (Google, GitHub, etc.) via Supabase Auth
4. **Set up Supabase Storage** for PDF documents
5. **Configure database backups**
6. **Set up monitoring** and error tracking
7. **Deploy to production**

---

## Support

- **Supabase Docs**: https://supabase.com/docs/guides/auth
- **Supabase Discord**: https://discord.supabase.com
- **Security Best Practices**: https://supabase.com/docs/guides/auth/row-level-security

---

**Migration complete!** 🎉

Your app now uses:
✅ Supabase Auth (email/password with verification)
✅ Row Level Security (RLS)
✅ Encrypted Plaid tokens (AES-256-GCM)
✅ JWT-based API authentication
✅ Multi-tenant data isolation
