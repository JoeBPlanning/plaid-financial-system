# Quick Start Guide

## Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)
- Plaid API credentials (Client ID and Secret)

## Step 1: Install Dependencies

### Backend Dependencies

```bash
cd backend
npm install
```

### Frontend Dependencies

```bash
cd frontend
npm install
```

## Step 2: Set Up Environment Variables

### Backend (.env file)

Create a `.env` file in the `backend` directory:

```bash
cd backend
touch .env
```

Add the following to `backend/.env`:

```env
# Plaid Configuration
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret
PLAID_ENV=sandbox

# Server Configuration
PORT=3001
```

**Get your Plaid credentials:**
1. Go to https://dashboard.plaid.com/developers/keys
2. Copy your Client ID and Secret
3. Paste them into the `.env` file

> **Note:** For SQLite, you don't need `MONGODB_URI` anymore. The database file (`plaid-financial-system.db`) will be created automatically.

## Step 3: Start the Servers

You'll need **two terminal windows** - one for backend, one for frontend.

### Terminal 1: Backend Server

```bash
cd backend
node server.js
```

**Or with auto-reload (recommended):**
```bash
cd backend
npx nodemon server.js
```

You should see:
```
📦 SQLite database initialized: /path/to/backend/plaid-financial-system.db
🚀 Server running on port 3001
📡 Visit: http://localhost:3001
🔧 Environment: sandbox
```

### Terminal 2: Frontend Server

```bash
cd frontend
npm start
```

The frontend will:
- Start on **http://localhost:3000**
- Automatically open in your browser
- Hot-reload when you make changes

## Step 4: Verify Everything Works

1. **Backend Health Check:**
   ```bash
   curl http://localhost:3001/health
   ```

2. **Frontend:** Should open automatically at http://localhost:3000

3. **Test User Login:**
   - Username: `testuser`
   - Password: `password123`

## Creating a Test User

If the test user doesn't exist, create it:

```bash
curl -X POST http://localhost:3001/api/force-create-test-user
```

## Troubleshooting

### Backend won't start

**Error: "Cannot find module"**
```bash
cd backend
npm install
```

**Error: "PLAID_CLIENT_ID not found"**
- Make sure you created `backend/.env` file
- Check that your Plaid credentials are correct

**Error: "Port 3001 already in use"**
- Change the port in `backend/.env`: `PORT=3002`
- Or kill the process using port 3001

### Frontend won't start

**Error: "Cannot find module"**
```bash
cd frontend
npm install
```

**Error: "Port 3000 already in use"**
- The terminal will ask if you want to use a different port
- Type `Y` and press Enter

### Database Issues

**SQLite database not created:**
- Make sure the backend server started successfully
- Check that you have write permissions in the `backend` directory
- The database file will be created at: `backend/plaid-financial-system.db`

## Quick Commands Reference

### Start Backend
```bash
cd backend && node server.js
```

### Start Frontend
```bash
cd frontend && npm start
```

### Start Both (using separate terminals)
```bash
# Terminal 1
cd backend && node server.js

# Terminal 2
cd frontend && npm start
```

### View Database
```bash
cd backend
sqlite3 plaid-financial-system.db
```

Then run SQL queries:
```sql
SELECT * FROM clients;
SELECT * FROM plaid_access_tokens;
```

## What's Running Where

- **Backend API:** http://localhost:3001
- **Frontend App:** http://localhost:3000
- **Database:** `backend/plaid-financial-system.db` (SQLite file)

## Next Steps

1. Log in with test user credentials
2. Connect a bank account via Plaid Link
3. View transactions in the admin dashboard
4. Check the database using DB Browser for SQLite

For more details, see:
- `SETUP.md` - Detailed setup instructions
- `backend/SQLITE_SETUP.md` - Database viewing guide

