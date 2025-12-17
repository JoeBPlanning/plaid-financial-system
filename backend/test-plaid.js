const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
require('dotenv').config();

console.log('🔍 Testing Plaid connection...');
console.log('Client ID:', process.env.PLAID_CLIENT_ID ? '✅ Found' : '❌ Missing');
console.log('Secret:', process.env.PLAID_SECRET ? '✅ Found' : '❌ Missing');

const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const client = new PlaidApi(configuration);

async function testConnection() {
  try {
    const request = {
      user: {
        client_user_id: 'test-user-123'
      },
      client_name: "Test App",
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en'
    };

    console.log('📡 Attempting to create link token...');
    const response = await client.linkTokenCreate(request);
    
    console.log('✅ SUCCESS! Plaid connection works!');
    console.log('🔗 Link token created successfully');
    console.log('Token preview:', response.data.link_token.substring(0, 25) + '...');
    
  } catch (error) {
    console.log('❌ CONNECTION FAILED');
    console.log('Error message:', error.message);
    
    if (error.message.includes('client_id')) {
      console.log('💡 Issue with Client ID - check your .env file');
    }
    if (error.message.includes('secret')) {
      console.log('💡 Issue with Secret - try using your "sandbox token" as the secret');
    }
  }
}

testConnection();