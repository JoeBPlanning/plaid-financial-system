# Quick Start Guide for Cross-Client Safety Test

## Step-by-Step Instructions

### Step 1: Start the Server

**Open Terminal 1:**
```bash
cd backend
node server.js
```

Wait until you see: `Server running on port 3001` (or similar)

**Keep this terminal running!**

---

### Step 2: Create Test Users

**Open Terminal 2** (new terminal window):
```bash
cd backend
node setup-test-users.js
```

This will create:
- **Client A**: `testuser` / `password123`
- **Client B**: `testuser2` / `password123`

**Note the Client IDs** shown in the output!

---

### Step 3: Update Test Script

Edit `backend/test-cross-client-safety.js`:

```javascript
const CLIENT_A_CREDENTIALS = {
  username: 'testuser',      // ✅ From setup script
  password: 'password123'    // ✅ From setup script
};

const CLIENT_B_ID = 'client_test_user_2';  // ✅ Use Client B's ID from setup script output
```

---

### Step 4: Run the Test

**In Terminal 2** (same terminal as Step 2):
```bash
node test-cross-client-safety.js
```

---

## Expected Output

✅ All routes should show: `✅ 403 (Correct)`

If you see `❌ 200` or `❌ 201`, that's a **security issue** - stop and fix!

---

## Troubleshooting

### "Cannot connect to server"
- Make sure Step 1 is done (server is running)
- Check Terminal 1 shows the server is running

### "Login error"
- Make sure you ran `setup-test-users.js` first
- Check credentials match what was created

### "Client A ID matches Client B ID"
- Make sure `CLIENT_B_ID` is different from Client A's ID
- Use the Client IDs shown by the setup script

---

## All-in-One Commands

If you want to do it all at once:

**Terminal 1:**
```bash
cd backend && node server.js
```

**Terminal 2:**
```bash
cd backend && node setup-test-users.js && node test-cross-client-safety.js
```

(But you'll need to update the test script with Client B's ID first!)

