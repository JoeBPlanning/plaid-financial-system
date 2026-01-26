# Supabase Authentication Setup Guide

This guide will walk you through setting up Supabase authentication for your Financial Progress Portal.

## 1. Environment Variables Setup

### Frontend (.env)
Create a `.env` file in the `frontend/` directory:

```bash
REACT_APP_SUPABASE_URL=your-supabase-url
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
REACT_APP_API_BASE=https://plaid-financial-system-api.onrender.com
```

Replace `your-supabase-url` and `your-anon-key` with your actual values from the Supabase dashboard.

### Backend (.env)
Update your `backend/.env` file to include:

```bash
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 2. Install Required Dependencies

### Frontend
```bash
cd frontend
npm install @supabase/supabase-js
```

### Backend
```bash
cd backend
npm install @supabase/supabase-js
```

## 3. Create Your Advisor Account

You have two options to create an advisor account:

### Option A: Through the UI (Recommended)
1. Start the frontend application
2. Click "Sign up" on the login page
3. Fill in your details:
   - Full Name: Your Name
   - Email: your-email@example.com
   - Password: (create a strong password)
   - Confirm Password: (same password)
4. Check your email and verify your account
5. Log in to confirm everything works

### Option B: Directly in Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to Authentication > Users
3. Click "Add User"
4. Fill in:
   - Email: your-email@example.com
   - Password: your-password
   - Auto Confirm User: Yes (check this box)
5. After creating the user, click on the user to edit
6. Under "User Metadata", add:
   ```json
   {
     "name": "Your Name",
     "role": "advisor"
   }
   ```
7. Save the changes

## 4. Set User Role to Advisor

After creating your account, you need to set your role to "advisor" to access admin features:

### Using Supabase Dashboard:
1. Go to Authentication > Users
2. Find your user account
3. Click to edit the user
4. Under "User Metadata (user_metadata)" section, click "Edit"
5. Update the JSON to include the role:
   ```json
   {
     "name": "Your Name",
     "role": "advisor"
   }
   ```
6. Save the changes

### Using SQL Editor (Alternative):
1. Go to SQL Editor in your Supabase dashboard
2. Run this query (replace with your user's email):
   ```sql
   UPDATE auth.users
   SET raw_user_meta_data =
     jsonb_set(
       COALESCE(raw_user_meta_data, '{}'::jsonb),
       '{role}',
       '"advisor"'
     )
   WHERE email = 'your-email@example.com';
   ```

## 5. Verify Your Setup

### Test Authentication Flow:
1. **Sign Up**: Create a new test account
   - Should receive verification email
   - Should show success message

2. **Email Verification**: Click the link in your email
   - Should redirect to your app
   - Should show verification success

3. **Login**: Try logging in with verified account
   - Should successfully authenticate
   - Should redirect to dashboard
   - Should see your name in the header

4. **Forgot Password**: Test password reset
   - Enter your email
   - Should receive reset email
   - Click link to reset password

5. **Logout**: Click the logout button
   - Should return to login screen
   - Should clear session

### Test Admin Access (for advisor account):
1. Log in with your advisor account
2. Try accessing `/admin` route
3. Verify you can see all clients and admin features

## 6. Email Templates (Optional)

You can customize the email templates in Supabase:

1. Go to Authentication > Email Templates
2. Customize these templates:
   - Confirm signup
   - Magic Link
   - Change Email Address
   - Reset Password

## 7. Configure Email Provider (Optional but Recommended)

By default, Supabase uses its own email service with rate limits. For production:

1. Go to Authentication > Email Settings
2. Click "SMTP Settings"
3. Configure your email provider (SendGrid, Mailgun, etc.)

## 8. Security Configuration

### Row Level Security (RLS)
Make sure your database tables have proper RLS policies:

```sql
-- Example: Clients can only access their own data
CREATE POLICY "Users can view own data"
ON clients FOR SELECT
USING (auth.uid() = client_id);

CREATE POLICY "Users can update own data"
ON clients FOR UPDATE
USING (auth.uid() = client_id);

-- Example: Advisors can view all client data
CREATE POLICY "Advisors can view all data"
ON clients FOR SELECT
USING (
  (auth.jwt() ->> 'user_metadata' ->> 'role') IN ('advisor', 'admin')
);
```

### URL Configuration
In your Supabase dashboard:
1. Go to Authentication > URL Configuration (previously "Auth Settings")
2. Add your site URL: `https://your-domain.com`
3. Add redirect URLs:
   - `https://your-domain.com/**`
   - `http://localhost:3000/**` (for development)

## 9. Testing Checklist

## 9. Auto-Create Client Profile on Sign-Up (IMPORTANT)

To ensure a user profile is created in your `public.clients` table every time a new user signs up, you must create a database trigger.

1.  Go to the **SQL Editor** in your Supabase dashboard.
2.  Click **"+ New query"**.
3.  Paste and run the following SQL:

```sql
-- Creates a function that inserts a new row into public.clients
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Insert a new row into the clients table, using the user's ID and metadata
  insert into public.clients (client_id, email, name, raw_user_meta_data)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'name',
    new.raw_user_meta_data
  );
  return new;
end;
$$;

-- Drop the existing trigger if it exists to avoid errors on re-running the script
drop trigger if exists on_auth_user_created on auth.users;

-- Create the trigger that fires after a new user is inserted into auth.users
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

- [ ] Frontend environment variables are set
- [ ] Backend environment variables are set
- [ ] Dependencies are installed
- [ ] Advisor account is created
- [ ] Advisor role is set in user metadata
- [ ] Sign up works and sends verification email
- [ ] Email verification works
- [ ] Login works with verified account
- [ ] Login fails with unverified account
- [ ] Forgot password sends reset email
- [ ] Password reset works
- [ ] Logout clears session
- [ ] Admin routes work for advisor account
- [ ] Regular users cannot access admin routes
- [ ] API endpoints require authentication
- [ ] Users can only access their own data

## 10. Common Issues & Solutions

### Issue: "Missing Supabase environment variables"
**Solution**: Make sure you've created `.env` files in both frontend and backend directories with the correct variables.

### Issue: "Email not confirmed" error on login
**Solution**: Check your email for the verification link. In development, you can also manually confirm users in the Supabase dashboard.

### Issue: "Invalid or expired token" on API calls
**Solution**:
- Make sure the frontend is sending the token in the Authorization header
- Verify SUPABASE_SERVICE_ROLE_KEY is set in backend .env
- Check that the token hasn't expired (default: 1 hour)

### Issue: Cannot access admin routes
**Solution**: Verify your user metadata has `"role": "advisor"` or `"role": "admin"` set in Supabase dashboard.

### Issue: CORS errors
**Solution**: Update CORS configuration in `backend/server.js` to include your frontend URL.

## 11. Production Deployment

### Frontend (Render):
Add environment variables in your Render Static Site settings:
- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`
- `REACT_APP_API_BASE`

### Backend (Render/Heroku):
Add environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- All other existing environment variables

### Supabase:
1. Update redirect URLs to include production domain
2. Configure custom SMTP for production emails
3. Enable email rate limiting
4. Review security policies

## 12. Migration Notes

### Changes from Old System:
- ✅ Removed custom username/password authentication
- ✅ Removed bcrypt password hashing (now handled by Supabase)
- ✅ Removed JWT token generation (now handled by Supabase)
- ✅ Removed session cookies (now uses Supabase tokens)
- ✅ User ID is now Supabase UUID instead of custom clientId
- ✅ Role is stored in user_metadata instead of database

### Database Changes:
- User IDs are now UUIDs from Supabase (auth.uid())
- No need for username, password, or role fields in your users table
- Use Supabase user ID as foreign key in related tables

## Support

If you encounter any issues:
1. Check the Supabase documentation: https://supabase.com/docs
2. Check browser console for errors
3. Check backend logs for authentication errors
4. Verify all environment variables are set correctly
5. Test in an incognito window to rule out cached sessions
