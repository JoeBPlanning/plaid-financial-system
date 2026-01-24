const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

/**
 * Get the correct Plaid environment based on PLAID_ENV environment variable
 * @returns {string} The PlaidEnvironments constant
 */
const getPlaidEnvironment = () => {
  const env = process.env.PLAID_ENV?.toLowerCase();
  if (env === 'production') {
    return PlaidEnvironments.production;
  } else if (env === 'development') {
    return PlaidEnvironments.development;
  } else {
    return PlaidEnvironments.sandbox;
  }
};

/**
 * Create and return a configured Plaid client
 * @returns {PlaidApi} Configured Plaid API client
 */
const createPlaidClient = () => {
  const plaidBasePath = getPlaidEnvironment();
  
  if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
    console.warn('⚠️  Warning: Plaid credentials are missing. Some features may not work.');
  }
  
  const configuration = new Configuration({
    basePath: plaidBasePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });

  return new PlaidApi(configuration);
};

module.exports = {
  getPlaidEnvironment,
  createPlaidClient,
  PlaidEnvironments
};
