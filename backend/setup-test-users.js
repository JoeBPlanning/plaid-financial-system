/**
 * Setup Test Users for Cross-Client Safety Testing
 * 
 * This script creates two test users (Client A and Client B) for testing.
 * 
 * Usage:
 *   node setup-test-users.js
 * 
 * Then update test-cross-client-safety.js with the credentials shown.
 */

const axios = require('axios');
const API_BASE = process.env.API_BASE || 'http://localhost:3001';

async function createTestUser(username, password, name, email, clientId) {
  try {
    // First, try to delete existing user
    try {
      await axios.delete(`${API_BASE}/api/debug/testuser`, { validateStatus: () => true });
    } catch (e) {
      // Ignore errors
    }
    
    // Create user via force-create endpoint
    const response = await axios.post(`${API_BASE}/api/force-create-test-user`, {}, {
      validateStatus: () => true
    });
    
    if (response.status === 200) {
      return response.data.client;
    }
    
    // If that doesn't work, try the regular create endpoint
    const createResponse = await axios.post(`${API_BASE}/api/auth/create-test-user`, {}, {
      validateStatus: () => true
    });
    
    if (createResponse.status === 200) {
      return createResponse.data.client;
    }
    
    // Manual creation via register (if available)
    const registerResponse = await axios.post(`${API_BASE}/api/auth/register`, {
      username,
      password,
      name,
      email,
      advisorId: 'advisor_main'
    }, {
      validateStatus: () => true
    });
    
    if (registerResponse.status === 200 && registerResponse.data.success) {
      return registerResponse.data.client;
    }
    
    return null;
  } catch (error) {
    console.error(`Error creating ${username}:`, error.message);
    return null;
  }
}

async function getExistingUsers() {
  try {
    // Try to get test user
    const testUserResponse = await axios.get(`${API_BASE}/api/debug/testuser`, {
      validateStatus: () => true
    });
    
    if (testUserResponse.status === 200 && testUserResponse.data) {
      return [testUserResponse.data];
    }
    
    return [];
  } catch (error) {
    return [];
  }
}

async function setupTestUsers() {
  console.log('='.repeat(70));
  console.log('SETUP TEST USERS FOR CROSS-CLIENT SAFETY TESTING');
  console.log('='.repeat(70));
  
  // Check if server is running
  try {
    await axios.get(`${API_BASE}/health`, { timeout: 2000 });
    console.log(`\n✅ Server is running at ${API_BASE}`);
  } catch (error) {
    console.error(`\n❌ Cannot connect to server at ${API_BASE}`);
    console.error('\n📋 To fix this:');
    console.error('   1. Open a NEW terminal window');
    console.error('   2. Run: cd backend');
    console.error('   3. Run: node server.js');
    console.error('   4. Wait for "Server running on port 3001" message');
    console.error('   5. Then come back and run this script again\n');
    console.error('   Or in one command:');
    console.error('   cd backend && node server.js &\n');
    process.exit(1);
  }
  
  console.log('\n📝 Creating test users...\n');
  
  // Create Client A (testuser)
  console.log('Creating Client A (testuser)...');
  const clientA = await createTestUser(
    'testuser',
    'password123',
    'Test User A',
    'testuser@example.com',
    'client_test_user'
  );
  
  if (clientA) {
    console.log(`✅ Client A created:`);
    console.log(`   Username: testuser`);
    console.log(`   Password: password123`);
    console.log(`   Client ID: ${clientA.clientId}`);
  } else {
    console.log('⚠️  Could not create Client A automatically');
    console.log('   You may need to create it manually or it already exists');
  }
  
  // Create Client B (testuser2)
  console.log('\nCreating Client B (testuser2)...');
  const clientB = await createTestUser(
    'testuser2',
    'password123',
    'Test User B',
    'testuser2@example.com',
    'client_test_user_2'
  );
  
  if (clientB) {
    console.log(`✅ Client B created:`);
    console.log(`   Username: testuser2`);
    console.log(`   Password: password123`);
    console.log(`   Client ID: ${clientB.clientId}`);
  } else {
    console.log('⚠️  Could not create Client B automatically');
    console.log('   You may need to create it manually');
  }
  
  // Get existing users to show what's available
  console.log('\n📋 Checking existing users...');
  const existingUsers = await getExistingUsers();
  
  if (existingUsers.length > 0) {
    console.log('\n✅ Found existing test user:');
    existingUsers.forEach(user => {
      console.log(`   Username: ${user.username || 'N/A'}`);
      console.log(`   Client ID: ${user.clientId}`);
    });
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('NEXT STEPS');
  console.log('='.repeat(70));
  console.log('\n1. Update test-cross-client-safety.js with:');
  console.log('   CLIENT_A_CREDENTIALS = {');
  console.log('     username: \'testuser\',');
  console.log('     password: \'password123\'');
  console.log('   };');
  console.log('   CLIENT_B_ID = \'client_test_user_2\'; // or another client ID');
  console.log('\n2. Run the test:');
  console.log('   node test-cross-client-safety.js');
  console.log('\n💡 Tip: If users already exist, you can use their credentials.');
  console.log('   Check your database or use: GET /api/debug/testuser');
}

setupTestUsers().catch(error => {
  console.error('\n❌ Setup error:', error.message);
  process.exit(1);
});

