# Using .env.production for Real Banking Data

## Overview

You can use `.env.production` for real banking data (Plaid development mode) even when running locally. This keeps your real banking credentials separate from sandbox testing.

---

## Option 1: Use ENV_FILE Environment Variable (Recommended)

Run your backend with the `ENV_FILE` variable to specify which file to use:

```bash
cd backend
ENV_FILE=.env.production node server.js
```

Or use the npm script:
```bash
npm run start:real-banking
```

This will:
- ✅ Load `.env.production` (with real banking credentials)
- ✅ Keep `NODE_ENV=development` (if not set)
- ✅ Use real Plaid development mode

---

## Option 2: Set NODE_ENV=production

Run with production environment:

```bash
cd backend
NODE_ENV=production node server.js
```

Or use the npm script:
```bash
npm run start:prod
```

This will:
- ✅ Load `.env.production`
- ✅ Set `NODE_ENV=production`
- ⚠️ May enable production-only features/restrictions

---

## Option 3: Use npm Scripts

I've added convenient npm scripts to `package.json`:

```bash
# Development mode (sandbox) - uses .env.development
npm run start:dev

# Production mode - uses .env.production
npm run start:prod

# Real banking (production env file, but development NODE_ENV)
npm run start:real-banking
```

---

## Recommended Setup

### For Sandbox Testing (Fake Data)
```bash
# Uses .env.development with PLAID_ENV=sandbox
npm run start:dev
```

### For Real Banking Testing (Your Actual Accounts)
```bash
# Uses .env.production with PLAID_ENV=development
npm run start:real-banking
```

---

## Environment File Configuration

### `.env.development` (Sandbox Testing)
```bash
PLAID_ENV=sandbox
PLAID_SECRET=your_sandbox_secret
NODE_ENV=development
PORT=3001
# ... other vars
```

### `.env.production` (Real Banking)
```bash
PLAID_ENV=development  # Real banks, but development mode
PLAID_SECRET=your_development_secret
NODE_ENV=production
PORT=10000
# ... other vars
```

---

## Verify Which File is Loaded

When you start the server, you'll see:
```
📁 Loading environment from: .env.production
```

This confirms which file is being used.

---

## Quick Reference

| Command | Env File | NODE_ENV | Use Case |
|---------|----------|----------|----------|
| `npm run start:dev` | `.env.development` | `development` | Sandbox testing |
| `npm run start:real-banking` | `.env.production` | `development` | Real banking |
| `npm run start:prod` | `.env.production` | `production` | Production deploy |
| `ENV_FILE=.env.production node server.js` | `.env.production` | Current | Custom override |

---

## For Render.com Deployment

Render.com automatically sets `NODE_ENV=production`, so it will use `.env.production` by default. Make sure your Render environment variables match your `.env.production` file.

---

You can now easily switch between sandbox and real banking by using different npm scripts! 🎉
