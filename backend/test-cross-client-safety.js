/**
 * Cross-Client Safety Test
 * 
 * This script tests that Client A cannot access Client B's data.
 * 
 * Usage:
 *   1. Setup test users: node setup-test-users.js
 *   2. Update CLIENT_A_CREDENTIALS and CLIENT_B_ID below
 *   3. Make sure your server is running: npm start (or node server.js)
 *   4. Run: node test-cross-client-safety.js
 * 
 * Expected: All requests to Client B's data should return 403 Forbidden
 * 
 * Quick setup:
 *   - Run: node setup-test-users.js (creates testuser and testuser2)
 *   - Default credentials: username='testuser', password='password123'
 */

const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

// =============================================================================
// CONFIGURATION - Update these with your test data
// =============================================================================

// Client A credentials (will log in as this client)
const CLIENT_A_CREDENTIALS = {
  username: 'testuser',  // Update with a valid username
  password: 'password123'    // Update with a valid password
};

// Client B ID (will try to access this client's data)
const CLIENT_B_ID = 'client_test_user_2';  // Update with a different client's ID

// =============================================================================
// TEST ROUTES - All routes that accept :clientId parameter
// =============================================================================

const TEST_ROUTES = [
  // Client routes (should use ensureClientOwnership)
  { method: 'GET', path: `/api/clients/${CLIENT_B_ID}` },
  { method: 'GET', path: `/api/clients/${CLIENT_B_ID}/transactions` },
  { method: 'GET', path: `/api/clients/${CLIENT_B_ID}/investments` },
  { method: 'GET', path: `/api/clients/${CLIENT_B_ID}/balance-sheets` },
  { method: 'GET', path: `/api/clients/${CLIENT_B_ID}/investment-snapshots` },
  { method: 'GET', path: `/api/clients/${CLIENT_B_ID}/summaries` },
  { method: 'POST', path: `/api/clients/${CLIENT_B_ID}/update-transaction-categories`, body: { transactions: [] } },
  { method: 'POST', path: `/api/clients/${CLIENT_B_ID}/refresh-transactions` },
  { method: 'POST', path: `/api/clients/${CLIENT_B_ID}/sync-transactions` },
  { method: 'POST', path: `/api/clients/${CLIENT_B_ID}/sync-investments` },
  { method: 'POST', path: `/api/clients/${CLIENT_B_ID}/balance-sheet-snapshot`, body: {} },
  { method: 'POST', path: `/api/clients/${CLIENT_B_ID}/investment-snapshot`, body: {} },
  { method: 'PUT', path: `/api/clients/${CLIENT_B_ID}/profile`, body: { name: 'Test' } },
  { method: 'POST', path: `/api/clients/${CLIENT_B_ID}/plaid-token`, body: { publicToken: 'test' } },
  
  // Admin routes (should validate req.params.clientId against req.user.clientId)
  { method: 'GET', path: `/api/admin/transactions/${CLIENT_B_ID}` },
  { method: 'GET', path: `/api/admin/summaries/${CLIENT_B_ID}` },
  { method: 'POST', path: `/api/admin/save-categories/${CLIENT_B_ID}`, body: { transactions: [] } },
  { method: 'POST', path: `/api/admin/regenerate-summary/${CLIENT_B_ID}`, body: { month: '2025-01' } },
  
  // Other routes
  { method: 'POST', path: `/api/process-transactions/${CLIENT_B_ID}`, body: {} },
  { method: 'GET', path: `/api/review-transactions/${CLIENT_B_ID}` },
  { method: 'POST', path: `/api/save-categorized-transactions/${CLIENT_B_ID}`, body: { transactions: [] } },
];

// =============================================================================
// TEST FUNCTIONS
// =============================================================================

async function loginAsClientA() {
  console.log('\n🔐 Step 1: Logging in as Client A...');
  console.log(`   Username: ${CLIENT_A_CREDENTIALS.username}`);
  console.log(`   API Base: ${API_BASE}`);
  
  try {
    const response = await axios.post(`${API_BASE}/api/auth/login`, CLIENT_A_CREDENTIALS, {
      withCredentials: true,
      maxRedirects: 0,
      validateStatus: () => true // Don't throw on any status
    });
    
    if (response.status === 200 && response.data.success) {
      console.log('✅ Login successful');
      console.log(`   Client ID: ${response.data.client.clientId}`);
      console.log(`   Client Name: ${response.data.client.name}`);
      
      // Extract cookies from response
      const cookies = response.headers['set-cookie'] || [];
      const sessionCookie = cookies.find(c => c.startsWith('session='));
      
      if (sessionCookie) {
        console.log('✅ Session cookie received');
        return { cookies: cookies, clientId: response.data.client.clientId };
      } else {
        console.error('❌ No session cookie received!');
        console.error('   Response headers:', Object.keys(response.headers));
        return null;
      }
    } else {
      console.error('❌ Login failed');
      console.error(`   Status: ${response.status}`);
      console.error(`   Response:`, response.data);
      
      if (response.status === 401) {
        console.error('\n💡 Tip: Invalid credentials. Check username/password.');
        console.error('   You can create test users with:');
        console.error('   curl -X POST http://localhost:3001/api/force-create-test-user');
      } else if (response.status === 0 || !response.status) {
        console.error('\n💡 Tip: Server might not be running or unreachable.');
        console.error(`   Check if server is running at: ${API_BASE}`);
      }
      
      return null;
    }
  } catch (error) {
    console.error('❌ Login error:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Tip: Cannot connect to server.');
      console.error(`   Make sure the server is running at: ${API_BASE}`);
      console.error('   Start server with: npm start (or node server.js)');
    } else if (error.response) {
      console.error(`   Status: ${error.response.status}`);
      console.error(`   Response:`, error.response.data);
    } else {
      console.error('   Full error:', error);
    }
    
    return null;
  }
}

async function testRoute(method, path, cookies, body = null) {
  try {
    const config = {
      method: method.toLowerCase(),
      url: `${API_BASE}${path}`,
      headers: {
        'Cookie': cookies.join('; ')
      },
      withCredentials: true,
      validateStatus: () => true // Don't throw on any status code
    };
    
    if (body) {
      config.data = body;
    }
    
    const response = await axios(config);
    
    return {
      status: response.status,
      success: response.status === 403,
      error: response.data?.error || response.data?.message || 'Unknown error'
    };
  } catch (error) {
    return {
      status: error.response?.status || 500,
      success: false,
      error: error.message
    };
  }
}

async function runTests() {
  console.log('='.repeat(70));
  console.log('CROSS-CLIENT SAFETY TEST');
  console.log('='.repeat(70));
  console.log(`\nTesting access to Client B (ID: ${CLIENT_B_ID})`);
  console.log(`while logged in as Client A\n`);
  
  // Step 1: Login as Client A
  const loginResult = await loginAsClientA();
  if (!loginResult) {
    console.error('\n❌ Cannot proceed without successful login');
    process.exit(1);
  }
  
  const { cookies, clientId: clientAId } = loginResult;
  
  if (clientAId === CLIENT_B_ID) {
    console.error(`\n⚠️  WARNING: Client A ID (${clientAId}) matches Client B ID (${CLIENT_B_ID})`);
    console.error('   Please use different client IDs for this test!');
    process.exit(1);
  }
  
  console.log(`\n🔒 Step 2: Testing ${TEST_ROUTES.length} routes...`);
  console.log(`   Attempting to access Client B's data (ID: ${CLIENT_B_ID})`);
  console.log(`   Expected: All requests should return 403 Forbidden\n`);
  
  // Step 2: Test all routes
  const results = [];
  for (let i = 0; i < TEST_ROUTES.length; i++) {
    const route = TEST_ROUTES[i];
    process.stdout.write(`   [${i + 1}/${TEST_ROUTES.length}] ${route.method} ${route.path} ... `);
    
    const result = await testRoute(route.method, route.path, cookies, route.body);
    results.push({
      route: `${route.method} ${route.path}`,
      ...result
    });
    
    if (result.success) {
      console.log(`✅ 403 (Correct)`);
    } else if (result.status === 401) {
      console.log(`⚠️  401 (Auth required - might be OK if route needs auth)`);
    } else if (result.status === 404) {
      console.log(`⚠️  404 (Not found - might be OK if resource doesn't exist)`);
    } else {
      console.log(`❌ ${result.status} (SECURITY ISSUE!)`);
      console.log(`      Error: ${result.error}`);
    }
    
    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Step 3: Summary
  console.log('\n' + '='.repeat(70));
  console.log('TEST SUMMARY');
  console.log('='.repeat(70));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success && r.status !== 404 && r.status !== 401).length;
  const warnings = results.filter(r => r.status === 404 || r.status === 401).length;
  
  console.log(`\n✅ Passed (403 Forbidden): ${passed}/${results.length}`);
  console.log(`❌ Failed (Security Issue): ${failed}/${results.length}`);
  console.log(`⚠️  Warnings (404/401): ${warnings}/${results.length}`);
  
  if (failed > 0) {
    console.log('\n🚨 SECURITY ISSUES FOUND:');
    results
      .filter(r => !r.success && r.status !== 404 && r.status !== 401)
      .forEach(r => {
        console.log(`   ❌ ${r.route}`);
        console.log(`      Status: ${r.status}`);
        console.log(`      Error: ${r.error}`);
      });
    console.log('\n⚠️  ACTION REQUIRED: Fix these routes before deploying!');
    process.exit(1);
  } else if (passed === results.length) {
    console.log('\n✅ ALL TESTS PASSED - Cross-client access is properly blocked!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some routes returned 404/401 - verify these are expected');
    console.log('   (404 = resource not found, 401 = auth required)');
    process.exit(0);
  }
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Test execution error:', error);
  process.exit(1);
});

