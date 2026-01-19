# Frontend Deployment Guide

## Current Situation

- ✅ **Backend API**: Deployed on Render at `https://plaid-financial-system-api.onrender.com`
- ⚠️ **Frontend UI**: Not yet deployed (needs separate deployment)

---

## Option 1: Deploy Frontend to Render (Static Site)

### Step 1: Build the Frontend

```bash
cd frontend
npm install
npm run build
```

This creates a `build/` folder with static files.

### Step 2: Create Static Site on Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Static Site"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `plaid-financial-system-frontend` (or your choice)
   - **Root Directory**: `frontend` ⚠️ **IMPORTANT: Set this first!**
   - **Build Command**: `npm install && npm run build`
     - **Note**: Don't use `cd frontend` here because Root Directory is already set
   - **Publish Directory**: `build`
     - **Note**: This is relative to the Root Directory (`frontend/build` becomes just `build`)
   - **Environment Variables**:
     ```
     REACT_APP_API_BASE=https://plaid-financial-system-api.onrender.com
     ```

5. Click **"Create Static Site"**

**Key Settings:**
- ✅ **Root Directory**: `frontend` (tells Render where your frontend code is)
- ✅ **Build Command**: `npm install && npm run build` (runs from the root directory)
- ✅ **Publish Directory**: `build` (relative to root directory)

### Step 3: Update CORS on Backend

Make sure your backend allows requests from your new frontend URL:

In `backend/server.js`, update the CORS configuration to include your Render frontend URL:
```javascript
const allowedOrigins = [
  'http://localhost:3000',
  'https://your-frontend-name.onrender.com', // Add your Render frontend URL
  process.env.FRONTEND_URL
].filter(Boolean);
```

---

## Option 2: Deploy to Vercel (Recommended for React)

Vercel is optimized for React apps and provides automatic deployments.

### Step 1: Push to GitHub (If Using GitHub Integration)

If you're connecting Vercel to your GitHub repository:
1. **Commit and push your changes:**
   ```bash
   git add .
   git commit -m "Prepare frontend for Vercel deployment"
   git push origin main
   ```

2. **Wait for push to complete** before connecting to Vercel

### Step 2: Connect Repository to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. **Import your GitHub repository**
4. Configure the project:
   - **Framework Preset**: React (auto-detected)
   - **Root Directory**: `frontend` ⚠️ **IMPORTANT: Set this!**
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `build` (auto-detected)
   - **Install Command**: `npm install` (auto-detected)

5. **Add Environment Variable:**
   - Click **"Environment Variables"**
   - Add: `REACT_APP_API_BASE` = `https://plaid-financial-system-api.onrender.com`
   - Select **Production**, **Preview**, and **Development** environments

6. Click **"Deploy"**

### Alternative: Deploy via Vercel CLI

If you prefer CLI:

```bash
# Install Vercel CLI globally
npm install -g vercel

# Navigate to frontend directory
cd frontend

# Deploy
vercel
```

When prompted:
- **Set up and deploy?** → Yes
- **Which scope?** → Your account
- **Link to existing project?** → No (first time) or Yes (if updating)
- **What's your project's name?** → `plaid-financial-system-frontend`
- **In which directory is your code located?** → `./` (since you're already in frontend)
- **Want to override the settings?** → Yes
  - **Root Directory**: `./` (you're already in frontend)
  - **Build Command**: `npm run build`
  - **Output Directory**: `build`

Add environment variable:
```bash
vercel env add REACT_APP_API_BASE
# Enter: https://plaid-financial-system-api.onrender.com
# Select: Production, Preview, Development
```

### Step 3: Update CORS

After deployment, add your Vercel URL to the backend CORS configuration.

---

## Option 3: Deploy to Netlify

### Step 1: Build Command

```bash
cd frontend
npm run build
```

### Step 2: Deploy via Netlify Dashboard

1. Go to [Netlify](https://app.netlify.com/)
2. Drag and drop the `frontend/build` folder
3. Or connect your GitHub repo and set:
   - **Build command**: `cd frontend && npm install && npm run build`
   - **Publish directory**: `frontend/build`
   - **Environment variable**: `REACT_APP_API_BASE=https://plaid-financial-system-api.onrender.com`

---

## Option 4: Test Locally with Production Backend

If you want to test the frontend locally but use the production backend:

### Step 1: Update Frontend Environment

Create or update `frontend/.env.development`:
```bash
REACT_APP_API_BASE=https://plaid-financial-system-api.onrender.com
```

### Step 2: Start Frontend

```bash
cd frontend
npm start
```

The frontend will run on `http://localhost:3000` but will connect to your production backend.

**Note**: Make sure your backend CORS allows `http://localhost:3000`.

---

## Quick Test: Verify Backend is Accessible

Test your backend API:
```bash
curl https://plaid-financial-system-api.onrender.com/health
```

Should return:
```json
{
  "message": "Plaid Financial System API is running!",
  "timestamp": "...",
  "environment": "development",
  "database": "connected (Supabase/PostgreSQL)"
}
```

---

## Recommended Setup

For production, I recommend:

1. **Backend**: Render (already done ✅)
2. **Frontend**: Vercel or Render Static Site
3. **Update CORS**: Add frontend URL to backend's allowed origins

---

## After Deployment

Once your frontend is deployed:

1. **Get your frontend URL** (e.g., `https://your-app.vercel.app`)
2. **Update backend CORS** to allow your frontend URL
3. **Update `FRONTEND_URL`** environment variable in Render backend settings
4. **Test the full flow**: Login → Connect Bank → View Transactions

---

## Troubleshooting

### Error: "Could not read package.json: ENOENT"

**Problem**: Render can't find `frontend/package.json`

**Solution**: Set the **Root Directory** in Render:
1. Go to your Static Site settings in Render
2. Find **"Root Directory"** field
3. Set it to: `frontend`
4. Update **Build Command** to: `npm install && npm run build` (remove `cd frontend`)
5. Update **Publish Directory** to: `build` (not `frontend/build`)
6. Save and redeploy

**Why this works**: The Root Directory tells Render where your frontend code lives. Once set, all paths are relative to that directory.

### CORS Errors

If you see CORS errors, make sure:
- Frontend URL is in backend's `allowedOrigins` array
- `FRONTEND_URL` environment variable is set in Render backend
- Backend is restarted after CORS changes

### API Connection Issues

- Verify `REACT_APP_API_BASE` is set correctly in your frontend deployment
- Check browser console for API errors
- Verify backend is running and accessible
