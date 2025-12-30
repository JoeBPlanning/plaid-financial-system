# Invite-Only Registration System - Complete Implementation Guide

## 🎯 Overview

This system implements a secure, invite-only registration flow where only users with valid invite codes can register.

---

## 📁 Files Created

### Backend
- `backend/migrations/005_invite_codes.sql` - Database table and RLS policies
- `backend/routes/invites.js` - Invite API endpoints
- `backend/routes/invites-email.js` - Email sending routes (merge into invites.js)
- `backend/services/emailService.js` - Email templates and sending logic

### Frontend
- `frontend/src/components/AdminInviteGenerator.js` - Admin interface to generate invites
- `frontend/src/components/InviteOnlyRegistration.js` - Two-step registration flow

---

## 🚀 Step-by-Step Implementation

### Step 1: Run Database Migration

1. Go to Supabase SQL Editor
2. Run the migration:

```sql
-- Copy and paste: backend/migrations/005_invite_codes.sql
```

3. Verify table was created:

```sql
SELECT * FROM invite_codes;
SELECT * FROM information_schema.tables WHERE table_name = 'invite_codes';
```

---

### Step 2: Update Backend server.js

Add invite routes to your server:

```javascript
// backend/server.js

// Add this with your other route imports (around line 24)
const inviteRoutes = require('./routes/invites');

// Add this with your other route registrations (around line 104)
app.use('/api/invites', inviteRoutes);
```

**Complete code addition:**

```javascript
// After line 103 (after app.use('/api/clients', clientRoutes);)
// Add invite routes
const inviteRoutes = require('./routes/invites');
app.use('/api/invites', inviteRoutes);
```

---

### Step 3: Merge Email Routes into invites.js

Open `backend/routes/invites.js` and add these routes at the bottom (before `module.exports`):

```javascript
// backend/routes/invites.js

// Add this code to the bottom of the file, before module.exports

const { sendInviteEmail, getEmailServiceStatus } = require('../services/emailService');

/**
 * POST /api/invites/send-email
 * Send invite email to client
 */
router.post(
  '/send-email',
  requireSupabaseAuth,
  requireAdvisor,
  [body('inviteCode').trim().notEmpty()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: 'Validation failed' });
      }

      const { inviteCode } = req.body;
      const supabase = getDatabase();

      const { data: invite } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', inviteCode.toUpperCase())
        .eq('created_by', req.user.id)
        .single();

      if (!invite) {
        return res.status(404).json({ success: false, error: 'Invite code not found' });
      }

      if (invite.is_used) {
        return res.status(400).json({ success: false, error: 'Cannot send email for used code' });
      }

      const result = await sendInviteEmail(invite.code, invite.client_name, invite.email);

      if (result.success) {
        res.json({ success: true, message: `Email sent to ${invite.email}`, provider: result.provider });
      } else {
        res.status(500).json({ success: false, error: result.message, emailContent: result.emailContent });
      }
    } catch (error) {
      console.error('Error sending email:', error);
      res.status(500).json({ success: false, error: 'Failed to send email' });
    }
  }
);

/**
 * GET /api/invites/email-status
 */
router.get(
  '/email-status',
  requireSupabaseAuth,
  requireAdvisor,
  async (req, res) => {
    try {
      const status = getEmailServiceStatus();
      res.json({ success: true, ...status });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to get email status' });
    }
  }
);

module.exports = router;
```

---

### Step 4: Configure Email Service (Optional)

Choose ONE email provider:

#### Option A: SendGrid (Recommended)

```bash
npm install @sendgrid/mail
```

Add to `.env`:
```bash
SENDGRID_API_KEY=your-sendgrid-api-key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
```

#### Option B: Resend

```bash
npm install resend
```

Add to `.env`:
```bash
RESEND_API_KEY=your-resend-api-key
RESEND_FROM_EMAIL=onboarding@yourdomain.com
```

#### Option C: Custom SMTP

```bash
npm install nodemailer
```

Add to `.env`:
```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Financial Portal <noreply@yourdomain.com>"
```

#### Option D: No Email Provider

If no provider is configured, invite codes can still be copied and sent manually via text/message.

---

### Step 5: Update Frontend Routing

Update your `frontend/src/App.js` to include the new routes:

```javascript
// frontend/src/App.js

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import InviteOnlyRegistration from './components/InviteOnlyRegistration';
import AdminInviteGenerator from './components/AdminInviteGenerator';
import Dashboard from './components/Dashboard'; // Your existing dashboard

// Protected route component
function ProtectedRoute({ children, requireAdvisor = false }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (requireAdvisor && user.user_metadata?.role !== 'advisor') {
    return <Navigate to="/dashboard" />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<InviteOnlyRegistration />} />

      {/* Protected routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* Admin routes (advisor only) */}
      <Route
        path="/admin/invites"
        element={
          <ProtectedRoute requireAdvisor={true}>
            <AdminInviteGenerator />
          </ProtectedRoute>
        }
      />

      {/* Redirect root to dashboard or login */}
      <Route
        path="/"
        element={<Navigate to="/dashboard" replace />}
      />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

---

### Step 6: Create Your First Advisor User

In Supabase Dashboard:

1. Go to **Authentication** → **Users**
2. Click **Add user**
3. Set:
   - Email: `your-email@example.com`
   - Password: `your-secure-password`
   - User Metadata:
     ```json
     {
       "name": "Your Name",
       "role": "advisor",
       "advisor_id": "advisor_main"
     }
     ```
4. Click **Create user**
5. Verify email if required

---

## 🎬 Usage Workflow

### As Advisor (You):

1. **Login** at `/login`

2. **Go to Invite Generator** at `/admin/invites`

3. **Generate Invite:**
   - Enter client name: "John Doe"
   - Enter client email: "john@example.com"
   - Click "Generate Invite Code"
   - Code appears: `XK7M-2P9Q`

4. **Send Invite:**
   - **Option A (Email):** Click "Send Email" (if email provider configured)
   - **Option B (Manual):** Click "Copy Code" and text/message to client

5. **Track Status:**
   - View all invites in the table
   - See which are used, active, or expired
   - Filter by status or search by name

### As Client:

1. **Receive Invite:**
   - Get email with invite code or receive it via text

2. **Register:**
   - Go to registration page (click link in email or go to `/register`)
   - Enter invite code: `XK7M-2P9Q`
   - Click "Continue"

3. **Complete Registration:**
   - Email is pre-filled (can't change)
   - Enter full name
   - Create password
   - Confirm password
   - Click "Create Account"

4. **Verify Email:**
   - Check email for verification link
   - Click link to verify

5. **Login:**
   - Go to `/login`
   - Enter email and password
   - Access dashboard

---

## 🔒 Security Features

### Implemented:

✅ **Invite codes expire** after 30 days
✅ **One-time use** - can't reuse codes
✅ **Email verification** - code tied to specific email
✅ **Rate limiting** - prevents brute force
✅ **RLS policies** - database-level security
✅ **Role-based access** - only advisors can generate codes
✅ **Auto-cleanup** - expired codes auto-deleted after 90 days

### Database Security (RLS):

```sql
-- Only advisors can create invites
-- Only advisors can view their own invites
-- Public can verify codes (for registration)
-- Service role marks codes as used (secure)
```

---

## 🧪 Testing

### Test Invite Generation:

```bash
# As advisor
curl -X POST http://localhost:3001/api/invites/generate \
  -H "Authorization: Bearer YOUR_ADVISOR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Test User","email":"test@example.com"}'
```

### Test Invite Verification:

```bash
# Public (no auth)
curl http://localhost:3001/api/invites/verify/XXXX-YYYY
```

### Test Registration Flow:

1. Generate invite in admin panel
2. Copy registration URL
3. Open in incognito window
4. Complete registration
5. Verify code is marked as used

---

## 📊 Database Queries

### View All Invites:

```sql
SELECT
  code,
  client_name,
  email,
  is_used,
  created_at,
  expires_at,
  CASE
    WHEN is_used THEN 'Used'
    WHEN expires_at < NOW() THEN 'Expired'
    ELSE 'Active'
  END as status
FROM invite_codes
ORDER BY created_at DESC;
```

### View Active Invites:

```sql
SELECT *
FROM invite_codes
WHERE is_used = false
AND expires_at > NOW()
ORDER BY created_at DESC;
```

### Cleanup Expired Invites:

```sql
SELECT cleanup_expired_invites(); -- Removes codes expired >90 days ago
```

---

## 🎨 Customization

### Change Expiration Period:

Edit `backend/routes/invites.js` line ~95:

```javascript
// Current: 30 days
expiresAt.setDate(expiresAt.getDate() + 30);

// Change to 60 days:
expiresAt.setDate(expiresAt.getDate() + 60);
```

### Change Invite Code Format:

Edit `backend/routes/invites.js` `generateInviteCode()` function:

```javascript
// Current format: XXXX-YYYY (8 chars)
// Change to 6 chars: XXX-YYY
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  for (let i = 0; i < 3; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  code += '-';

  for (let i = 0; i < 3; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return code;
}
```

### Customize Email Template:

Edit `backend/services/emailService.js` `sendInviteEmailSupabase()` function.

---

## 🔧 Troubleshooting

### "Invite code not found"

- Check code format is `XXXX-YYYY`
- Verify code exists in database
- Ensure code hasn't expired

### "Email does not match invite code"

- Email is case-insensitive but must match exactly
- Check for typos in email

### "Email not sending"

- Verify email provider is configured
- Check API keys in `.env`
- Check logs for specific error
- Use manual copy if no email provider

### "RLS policy violation"

- Verify advisor user has `role: 'advisor'` in user_metadata
- Check you're using correct JWT token
- Verify policies are enabled on table

---

## 📧 Email Provider Setup Guides

### SendGrid Setup:

1. Sign up at sendgrid.com
2. Create API key (Settings → API Keys)
3. Verify sender email
4. Add to `.env`:
   ```bash
   SENDGRID_API_KEY=SG.xxxxx
   SENDGRID_FROM_EMAIL=noreply@yourdomain.com
   ```

### Gmail SMTP Setup:

1. Enable 2FA on Gmail account
2. Generate App Password (Security → App Passwords)
3. Add to `.env`:
   ```bash
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-16-char-app-password
   SMTP_FROM="Your Name <your-email@gmail.com>"
   ```

---

## ✅ Final Checklist

### Backend:
- [ ] Migration 005 run in Supabase
- [ ] `invites.js` routes added to `server.js`
- [ ] Email routes merged into `invites.js`
- [ ] Email service configured (or manual copy used)
- [ ] Advisor user created with role metadata

### Frontend:
- [ ] `AdminInviteGenerator.js` component created
- [ ] `InviteOnlyRegistration.js` component created
- [ ] Routes added to `App.js`
- [ ] Protected route for `/admin/invites`
- [ ] Public route for `/register`

### Testing:
- [ ] Can generate invite as advisor
- [ ] Can copy invite code
- [ ] Can send email (if configured)
- [ ] Can verify invite code
- [ ] Can register with valid code
- [ ] Can't register without code
- [ ] Can't reuse code
- [ ] Expired codes rejected

---

## 🎉 You're Done!

Your invite-only registration system is now complete!

**Workflow:**
1. You generate invites for clients
2. They receive invite code (email or manual)
3. They register using the code
4. Account is created and code is marked as used
5. They verify email and login

**Security:**
- Only invited users can register
- Codes expire after 30 days
- One-time use per code
- Email verification required
- Database-level security with RLS

---

## 📚 Additional Resources

- **Supabase Auth Docs**: https://supabase.com/docs/guides/auth
- **SendGrid API**: https://docs.sendgrid.com/api-reference
- **Rate Limiting**: https://github.com/express-rate-limit/express-rate-limit

---

## 🆘 Need Help?

Check the troubleshooting section above or review:
- Database migration: `005_invite_codes.sql`
- API routes: `backend/routes/invites.js`
- Components: `AdminInviteGenerator.js`, `InviteOnlyRegistration.js`
