const moment = require('moment');
const Client = require('../models-supabase/Client');
const Investment = require('../models-supabase/Investment');
const InvestmentSnapshot = require('../models-supabase/InvestmentSnapshot');
const investmentsSync = require('./investmentsSync');

/**
 * Organize investments by tax type and account
 * Returns structured data for frontend display
 */
function organizeInvestmentsByTaxType(investments) {
  const totalByTaxType = {
    'tax-free': 0,
    'tax-deferred': 0,
    'taxable': 0
  };
  
  const holdingsByAccount = {};
  const holdingsBySecurity = {};
  
  let totalValue = 0;
  
  // First pass: calculate totals and group by account
  investments.forEach(inv => {
    const value = inv.value || 0;
    totalValue += value;
    
    const taxType = inv.accountTaxType || 'taxable';
    totalByTaxType[taxType] = (totalByTaxType[taxType] || 0) + value;
    
    // Group by account
    const accountKey = `${inv.accountId}_${inv.accountName}`;
    if (!holdingsByAccount[accountKey]) {
      holdingsByAccount[accountKey] = {
        accountId: inv.accountId,
        accountName: inv.accountName,
        accountType: inv.accountType,
        accountSubtype: inv.accountSubtype,
        accountTaxType: taxType,
        institutionName: inv.institutionName,
        totalValue: 0,
        holdings: []
      };
    }
    
    holdingsByAccount[accountKey].totalValue += value;
    holdingsByAccount[accountKey].holdings.push({
      securityId: inv.securityId,
      securityName: inv.securityName,
      securityTicker: inv.securityTicker,
      securityType: inv.securityType,
      quantity: inv.quantity,
      price: inv.price,
      value: value,
      costBasis: inv.costBasis,
      percentage: 0 // Will be calculated in second pass
    });
    
    // Group by security across all accounts
    const securityKey = inv.securityId;
    if (!holdingsBySecurity[securityKey]) {
      holdingsBySecurity[securityKey] = {
        securityId: inv.securityId,
        securityName: inv.securityName,
        securityTicker: inv.securityTicker,
        securityType: inv.securityType,
        totalValue: 0,
        accounts: []
      };
    }
    
    holdingsBySecurity[securityKey].totalValue += value;
    holdingsBySecurity[securityKey].accounts.push({
      accountId: inv.accountId,
      accountName: inv.accountName,
      accountTaxType: taxType,
      value: value,
      quantity: inv.quantity
    });
  });
  
  // Second pass: calculate percentages
  Object.values(holdingsByAccount).forEach(account => {
    account.holdings.forEach(holding => {
      holding.percentage = account.totalValue > 0 
        ? (holding.value / account.totalValue) * 100 
        : 0;
    });
    // Sort holdings by value (descending)
    account.holdings.sort((a, b) => b.value - a.value);
  });
  
  // Sort accounts by total value (descending)
  const sortedAccounts = Object.values(holdingsByAccount)
    .sort((a, b) => b.totalValue - a.totalValue);
  
  // Sort securities by total value (descending)
  const sortedSecurities = Object.values(holdingsBySecurity)
    .sort((a, b) => b.totalValue - a.totalValue);
  
  return {
    totalValue,
    totalByTaxType,
    holdingsByAccount: sortedAccounts,
    holdingsBySecurity: sortedSecurities
  };
}

/**
 * Map Plaid security type to asset class
 * Asset classes: US Equities, International, Emerging Markets, Real Estate, 
 * US Bonds, International Bonds, Cash, Other
 */
function mapSecurityToAssetClass(security) {
  const securityType = (security.securityType || '').toLowerCase();
  const securityName = (security.securityName || '').toLowerCase();
  const ticker = (security.securityTicker || '').toLowerCase();
  
  // Cash and money market
  if (securityType === 'cash' || securityType === 'money market' || 
      securityType === 'sweep' || securityName.includes('money market') ||
      securityName.includes('cash') || securityName.includes('sweep')) {
    return 'Cash';
  }
  
  // Real Estate
  if (securityType === 'reit' || securityType === 'real estate' ||
      securityName.includes('reit') || securityName.includes('real estate') ||
      securityName.includes('property') || ticker.includes('reit')) {
    return 'Real Estate';
  }
  
  // Bonds
  if (securityType === 'bond' || securityType === 'fixed income') {
    // Check if international bond
    if (securityName.includes('international') || securityName.includes('global') ||
        securityName.includes('foreign') || ticker.includes('intl') ||
        ticker.includes('global')) {
      return 'International Bonds';
    }
    // Default to US Bonds
    return 'US Bonds';
  }
  
  // Equities/Stocks
  if (securityType === 'equity' || securityType === 'stock' || 
      securityType === 'etf' || securityType === 'mutual fund') {
    
    // Check for emerging markets
    if (securityName.includes('emerging market') || securityName.includes('emerging markets') ||
        securityName.includes('em ') || ticker.includes('em') ||
        securityName.includes('china') || securityName.includes('india') ||
        securityName.includes('brazil') || securityName.includes('russia')) {
      return 'Emerging Markets';
    }
    
    // Check for international
    if (securityName.includes('international') || securityName.includes('global') ||
        securityName.includes('foreign') || securityName.includes('eafe') ||
        securityName.includes('europe') || securityName.includes('asia') ||
        securityName.includes('japan') || ticker.includes('intl') ||
        ticker.includes('global') || ticker.includes('eafe')) {
      return 'International';
    }
    
    // Default to US Equities
    return 'US Equities';
  }
  
  // Crypto and alternatives
  if (securityType === 'cryptocurrency' || securityType === 'crypto' ||
      securityName.includes('bitcoin') || securityName.includes('ethereum') ||
      securityName.includes('crypto') || ticker.includes('btc') ||
      ticker.includes('eth') || securityType === 'alternative') {
    return 'Other';
  }
  
  // Default to Other for unknown types
  return 'Other';
}

/**
 * Calculate asset class breakdown from investments
 */
function calculateAssetClassBreakdown(investments) {
  const breakdown = {
    'US Equities': 0,
    'International': 0,
    'Emerging Markets': 0,
    'Real Estate': 0,
    'US Bonds': 0,
    'International Bonds': 0,
    'Cash': 0,
    'Other': 0
  };
  
  investments.forEach(inv => {
    const assetClass = mapSecurityToAssetClass({
      securityType: inv.securityType,
      securityName: inv.securityName,
      securityTicker: inv.securityTicker
    });
    
    const value = inv.value || 0;
    breakdown[assetClass] = (breakdown[assetClass] || 0) + value;
  });
  
  return breakdown;
}

/**
 * Capture investment snapshot for a client
 * @param {string} clientId - Client ID
 * @param {string} snapshotDate - Date string (YYYY-MM-DD) or Date object. Defaults to today
 * @returns {Object} - Created investment snapshot
 */
async function captureInvestmentSnapshot(clientId, snapshotDate = null) {
  try {
    const client = await Client.findOne({ clientId });
    
    if (!client) {
      throw new Error(`Client ${clientId} not found`);
    }

    // Use provided date or today
    const date = snapshotDate 
      ? moment(snapshotDate).format('YYYY-MM-DD')
      : moment().format('YYYY-MM-DD');
    
    const monthYear = moment(date).format('YYYY-MM');

    // Check if snapshot already exists for this date
    const existing = await InvestmentSnapshot.findOne({ 
      clientId, 
      snapshotDate: date 
    });

    if (existing) {
      console.log(`Investment snapshot already exists for ${clientId} on ${date}`);
      return existing;
    }

    // Sync investments first to get latest data
    await investmentsSync.syncInvestmentsForClient(clientId);

    // Get current investments
    const investments = await Investment.find({ clientId });
    
    if (investments.length === 0) {
      console.log(`No investments found for ${clientId}`);
      // Still create snapshot with zero values
      return await InvestmentSnapshot.create({
        clientId,
        snapshotDate: date,
        monthYear,
        totalValue: 0,
        totalByTaxType: { 'tax-free': 0, 'tax-deferred': 0, 'taxable': 0 },
        holdingsByAccount: [],
        assetClassBreakdown: {
          'US Equities': 0,
          'International': 0,
          'Emerging Markets': 0,
          'Real Estate': 0,
          'US Bonds': 0,
          'International Bonds': 0,
          'Cash': 0,
          'Other': 0
        }
      });
    }

    // Organize investments by tax type
    const organized = organizeInvestmentsByTaxType(investments);
    
    // Calculate asset class breakdown
    const assetClassBreakdown = calculateAssetClassBreakdown(investments);

    // Create investment snapshot
    const snapshot = await InvestmentSnapshot.create({
      clientId,
      snapshotDate: date,
      monthYear,
      totalValue: organized.totalValue,
      totalByTaxType: organized.totalByTaxType,
      holdingsByAccount: organized.holdingsByAccount,
      assetClassBreakdown
    });

    console.log(`✅ Captured investment snapshot for ${clientId} on ${date}`);
    console.log(`   Total Value: $${organized.totalValue.toFixed(2)}`);
    console.log(`   Asset Classes:`, assetClassBreakdown);

    return snapshot;
  } catch (error) {
    console.error(`Error capturing investment snapshot for ${clientId}:`, error);
    throw error;
  }
}

/**
 * Capture investment snapshots for all active clients
 * Useful for scheduled jobs
 */
async function captureAllClientsInvestmentSnapshots(snapshotDate = null) {
  try {
    const clients = await Client.find({ isActive: true });
    
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const client of clients) {
      try {
        await captureInvestmentSnapshot(client.clientId, snapshotDate);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          clientId: client.clientId,
          error: error.message
        });
        console.error(`Failed to capture investment snapshot for ${client.clientId}:`, error.message);
      }
    }

    console.log(`\n📊 Investment Snapshot Summary:`);
    console.log(`   Success: ${results.success}`);
    console.log(`   Failed: ${results.failed}`);

    return results;
  } catch (error) {
    console.error('Error capturing investment snapshots for all clients:', error);
    throw error;
  }
}

/**
 * Get current or snapshot investments for a client
 * If before the 5th of current month, return current investments
 * If on or after the 5th, return the snapshot from the 5th
 */
async function getInvestmentsForDisplay(clientId) {
  const today = moment();
  const dayOfMonth = today.date();
  
  // If before the 5th, return current investments
  if (dayOfMonth < 5) {
    // Sync to get latest
    await investmentsSync.syncInvestmentsForClient(clientId);
    const investments = await Investment.find({ clientId });
    const organized = organizeInvestmentsByTaxType(investments);
    const assetClassBreakdown = calculateAssetClassBreakdown(investments);
    
    return {
      isSnapshot: false,
      date: today.format('YYYY-MM-DD'),
      totalValue: organized.totalValue,
      totalByTaxType: organized.totalByTaxType,
      holdingsByAccount: organized.holdingsByAccount,
      assetClassBreakdown
    };
  }
  
  // On or after the 5th, get snapshot from the 5th of current month
  const snapshotDate = today.date(5).format('YYYY-MM-DD');
  const snapshot = await InvestmentSnapshot.findOne({
    clientId,
    snapshotDate
  });
  
  if (snapshot) {
    return {
      isSnapshot: true,
      date: snapshot.snapshotDate,
      totalValue: snapshot.totalValue,
      totalByTaxType: snapshot.totalByTaxType,
      holdingsByAccount: snapshot.holdingsByAccount,
      assetClassBreakdown: snapshot.assetClassBreakdown
    };
  }
  
  // If no snapshot exists, return current investments as fallback
  await investmentsSync.syncInvestmentsForClient(clientId);
  const investments = await Investment.find({ clientId });
  const organized = organizeInvestmentsByTaxType(investments);
  const assetClassBreakdown = calculateAssetClassBreakdown(investments);
  
  return {
    isSnapshot: false,
    date: today.format('YYYY-MM-DD'),
    totalValue: organized.totalValue,
    totalByTaxType: organized.totalByTaxType,
    holdingsByAccount: organized.holdingsByAccount,
    assetClassBreakdown
  };
}

module.exports = {
  captureInvestmentSnapshot,
  captureAllClientsInvestmentSnapshots,
  getInvestmentsForDisplay,
  calculateAssetClassBreakdown,
  mapSecurityToAssetClass
};

