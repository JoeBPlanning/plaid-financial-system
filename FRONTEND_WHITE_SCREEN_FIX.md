# Fixing White Screen on Render Deployment

## Problem
You're seeing a white screen at `https://plaid-financial-system-frontend.onrender.com/`

## Root Cause
The build succeeded, but the app is crashing at runtime due to **missing environment variables** in Render.

## Required Environment Variables

Your frontend needs these environment variables set in Render:

1. **REACT_APP_API_BASE** - Backend API URL
2. **REACT_APP_SUPABASE_URL** - Your Supabase project URL
3. **REACT_APP_SUPABASE_ANON_KEY** - Your Supabase anonymous key

## Fix Steps

### Step 1: Add Environment Variables in Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click on your **Static Site** (`plaid-financial-system-frontend`)
3. Go to **"Environment"** tab
4. Click **"Add Environment Variable"**
5. Add these three variables:

```
REACT_APP_API_BASE=https://plaid-financial-system-api.onrender.com
REACT_APP_SUPABASE_URL=https://your-project.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

**Where to find Supabase values:**
- Go to your [Supabase Dashboard](https://app.supabase.com/)
- Select your project
- Go to **Settings** → **API**
- Copy:
  - **Project URL** → Use for `REACT_APP_SUPABASE_URL`
  - **anon/public key** → Use for `REACT_APP_SUPABASE_ANON_KEY`

### Step 2: Redeploy

After adding environment variables:

1. Go to **"Manual Deploy"** in Render
2. Click **"Clear build cache & deploy"**
3. Wait for deployment to complete

### Step 3: Verify

1. Open your site: `https://plaid-financial-system-frontend.onrender.com/`
2. Open browser **Developer Tools** (F12)
3. Check **Console** tab for errors
4. You should see the login page, not a white screen

## Debugging

If you still see a white screen:

### Check Browser Console

1. Open Developer Tools (F12)
2. Go to **Console** tab
3. Look for red error messages
4. Common errors:
   - `Missing Supabase environment variables` → Add env vars
   - `Network Error` → Check CORS settings on backend
   - `Cannot read property 'X' of undefined` → JavaScript error

### Check Network Tab

1. Open Developer Tools (F12)
2. Go to **Network** tab
3. Refresh the page
4. Look for failed requests (red)
5. Check if API calls are failing

### Verify Environment Variables

In Render, make sure:
- ✅ Variable names are **exactly** as shown (case-sensitive)
- ✅ No extra spaces or quotes
- ✅ Values are correct (especially Supabase URL and key)

## Quick Test

To verify environment variables are loaded:

1. After deployment, open browser console
2. Type: `process.env.REACT_APP_SUPABASE_URL`
3. Should show your Supabase URL (not `undefined`)

## Common Issues

### Issue: Still white screen after adding env vars

**Solution**: 
- Clear browser cache
- Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
- Check if variables are set correctly (no typos)

### Issue: "Network Error" or CORS errors

**Solution**: 
- Update backend CORS to allow your frontend URL
- In `backend/server.js`, add your Render frontend URL to `allowedOrigins`

### Issue: Build succeeds but app doesn't load

**Solution**:
- Check browser console for JavaScript errors
- Verify all environment variables are set
- Check Network tab for failed resource loads

## Environment Variables Checklist

Before deploying, ensure you have:

- [ ] `REACT_APP_API_BASE` set to your backend URL
- [ ] `REACT_APP_SUPABASE_URL` set to your Supabase project URL
- [ ] `REACT_APP_SUPABASE_ANON_KEY` set to your Supabase anon key
- [ ] All variables added in Render's Environment tab
- [ ] Redeployed after adding variables

## After Fix

Once the white screen is fixed, you should see:
- ✅ Login page loads
- ✅ Can register/login
- ✅ Dashboard appears after authentication
- ✅ No console errors

---

**Note**: Environment variables must be set in Render **before** building. If you add them after, you need to redeploy.
