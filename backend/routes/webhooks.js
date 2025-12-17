const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const Client = require('../models-sqlite/Client');
const transactionsSync = require('../services/transactionsSync');
const investmentsSync = require('../services/investmentsSync');

// Verify webhook signature from Plaid
function verifyWebhookSignature(body, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64');
  return hash === signature;
}

// Plaid webhook endpoint
// IMPORTANT: This route should NOT use authenticateToken middleware
// Plaid will call this endpoint directly
router.post('/plaid/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Verify webhook signature (Plaid sends this in headers)
    const signature = req.headers['plaid-verification'];
    const body = req.body.toString();
    const secret = process.env.PLAID_SECRET;
    
    if (!signature || !verifyWebhookSignature(body, signature, secret)) {
      console.error('⚠️ Invalid webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const webhook = JSON.parse(body);
    const { webhook_type, webhook_code, item_id, error } = webhook;
    
    console.log(`📬 Webhook received: ${webhook_type}.${webhook_code} for item ${item_id}`);
    
    // Find client by item_id
    const clients = await Client.find({});
    const client = clients.find(c => 
      c.plaidAccessTokens && 
      c.plaidAccessTokens.some(token => token.itemId === item_id)
    );
    
    if (!client) {
      console.warn(`⚠️ No client found for item_id: ${item_id}`);
      return res.json({ received: true, message: 'Client not found' });
    }
    
    // Handle different webhook types
    switch (webhook_type) {
      case 'TRANSACTIONS':
        if (webhook_code === 'SYNC_UPDATES_AVAILABLE') {
          console.log(`🔄 Syncing transactions for client ${client.clientId}`);
          try {
            await transactionsSync.syncTransactionsForClient(client.clientId, item_id);
            console.log(`✅ Transactions synced for client ${client.clientId}`);
          } catch (syncError) {
            console.error(`❌ Transaction sync failed:`, syncError);
          }
        } else if (webhook_code === 'DEFAULT_UPDATE') {
          console.log(`📊 Transaction default update for client ${client.clientId}`);
          // Handle default update if needed
        }
        break;
        
      case 'ITEM':
        if (webhook_code === 'ERROR') {
          console.error(`⚠️ Item error for client ${client.clientId}:`, error);
          // TODO: Notify client or admin about the error
          // You could send an email or store the error in the database
        } else if (webhook_code === 'PENDING_EXPIRATION') {
          console.warn(`⏰ Access token expiring soon for client ${client.clientId}`);
          // TODO: Implement token refresh or notify client to reconnect
        } else if (webhook_code === 'USER_PERMISSION_REVOKED') {
          console.warn(`🚫 User revoked permissions for client ${client.clientId}`);
          // TODO: Mark item as inactive or notify admin
        }
        break;
        
      case 'INVESTMENTS_TRANSACTIONS':
        if (webhook_code === 'SYNC_UPDATES_AVAILABLE') {
          console.log(`💼 Syncing investment transactions for client ${client.clientId}`);
          try {
            await investmentsSync.syncInvestmentsForClient(client.clientId);
            console.log(`✅ Investments synced for client ${client.clientId}`);
          } catch (syncError) {
            console.error(`❌ Investment sync failed:`, syncError);
          }
        }
        break;
        
      case 'HOLDINGS':
        if (webhook_code === 'DEFAULT_UPDATE') {
          console.log(`📈 Holdings update for client ${client.clientId}`);
          try {
            await investmentsSync.syncInvestmentsForClient(client.clientId);
          } catch (syncError) {
            console.error(`❌ Holdings sync failed:`, syncError);
          }
        }
        break;
        
      default:
        console.log(`ℹ️ Unhandled webhook type: ${webhook_type}.${webhook_code}`);
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    // Still return 200 to Plaid so they don't retry
    res.status(200).json({ received: true, error: 'Processing failed' });
  }
});

module.exports = router;

