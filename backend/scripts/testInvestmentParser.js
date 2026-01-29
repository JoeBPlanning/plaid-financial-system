#!/usr/bin/env node
/**
 * Investment Statement Parser (TEST MODE)
 * Parses various investment statement PDFs and extracts data
 * Supports: Fidelity 401k, Robinhood, Wealthfront HYSA, Wealthfront Roth IRA
 * 
 * Usage:
 *   npm run parse-investment -- ./statements/filename.pdf
 *   npm run parse-investment -- ./statements/filename.pdf --raw
 *   npm run parse-investment -- --all  (parse all PDFs in statements folder)
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

// Statement type detection patterns
const STATEMENT_PATTERNS = {
  fidelity_401k: {
    patterns: [/fidelity/i, /401\s*\(?\s*k\s*\)?/i, /retirement\s*plan/i],
    requiredMatches: 2,
    custodian: 'Fidelity',
    accountType: '401k',
    taxTreatment: 'tax_deferred'
  },
  robinhood: {
    patterns: [/robinhood/i, /account\s*statement/i, /brokerage/i],
    requiredMatches: 2,
    custodian: 'Robinhood',
    accountType: 'brokerage',
    taxTreatment: 'taxable'
  },
  wealthfront_hysa: {
    patterns: [/wealthfront/i, /cash\s*account/i, /high[\s-]*yield/i, /savings/i, /apy/i],
    requiredMatches: 2,
    custodian: 'Wealthfront',
    accountType: 'HYSA',
    taxTreatment: 'taxable'
  },
  wealthfront_roth: {
    patterns: [/wealthfront/i, /roth\s*ira/i, /individual\s*retirement/i],
    requiredMatches: 2,
    custodian: 'Wealthfront',
    accountType: 'Roth_IRA',
    taxTreatment: 'tax_free'
  },
  wealthfront_traditional_ira: {
    patterns: [/wealthfront/i, /traditional\s*ira/i, /individual\s*retirement/i],
    requiredMatches: 2,
    custodian: 'Wealthfront',
    accountType: 'Traditional_IRA',
    taxTreatment: 'tax_deferred'
  },
  vanguard_401k: {
    patterns: [/vanguard/i, /401\s*\(?\s*k\s*\)?/i],
    requiredMatches: 2,
    custodian: 'Vanguard',
    accountType: '401k',
    taxTreatment: 'tax_deferred'
  }
};

// Utility: Parse currency string to number
function parseCurrency(str) {
  if (!str) return 0;
  const cleaned = str.toString().replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Utility: Mask account number (keep last 4 digits)
function maskAccountNumber(accountNum) {
  if (!accountNum) return null;
  const cleaned = accountNum.toString().replace(/\D/g, '');
  if (cleaned.length <= 4) return '****';
  return '****' + cleaned.slice(-4);
}

// Utility: Extract date from text
function extractDate(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      // Try to parse the date
      const dateStr = match[1] || match[0];
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
    }
  }
  return null;
}

// Detect statement type
function detectStatementType(text) {
  const lowerText = text.toLowerCase();
  
  for (const [type, config] of Object.entries(STATEMENT_PATTERNS)) {
    let matches = 0;
    for (const pattern of config.patterns) {
      if (pattern.test(text)) {
        matches++;
      }
    }
    if (matches >= config.requiredMatches) {
      return {
        type,
        custodian: config.custodian,
        accountType: config.accountType,
        taxTreatment: config.taxTreatment
      };
    }
  }
  
  return {
    type: 'unknown',
    custodian: 'Unknown',
    accountType: 'Unknown',
    taxTreatment: 'unknown'
  };
}

// Parse Fidelity 401k statement
function parseFidelity401k(text) {
  const result = {
    statementDate: null,
    totalBalance: 0,
    holdings: [],
    contributions: {},
    assetAllocation: {}
  };
  
  // Extract statement date
  const datePatterns = [
    /(?:as of|ending|through)\s*[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /(\w+\s+\d{4})\s*statement/i
  ];
  result.statementDate = extractDate(text, datePatterns);
  
  // Extract total balance - look for various patterns
  const balancePatterns = [
    /total\s*(?:account\s*)?(?:balance|value)[:\s]*\$?([\d,]+\.?\d*)/i,
    /(?:ending|current)\s*balance[:\s]*\$?([\d,]+\.?\d*)/i,
    /account\s*total[:\s]*\$?([\d,]+\.?\d*)/i,
    /your\s*(?:account\s*)?balance[:\s]*\$?([\d,]+\.?\d*)/i
  ];
  
  for (const pattern of balancePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.totalBalance = parseCurrency(match[1]);
      if (result.totalBalance > 0) break;
    }
  }
  
  // Extract individual holdings/funds
  // Pattern: Fund name followed by shares and value
  const holdingPatterns = [
    /([A-Z][A-Za-z\s&]+(?:Fund|Index|Stock|Bond|Trust))\s*([\d,]+\.?\d*)\s*(?:shares?)?\s*\$?([\d,]+\.?\d*)/gi,
    /([A-Z]{2,5})\s+([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)/g // Ticker format
  ];
  
  for (const pattern of holdingPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      const shares = parseFloat(match[2].replace(/,/g, '')) || 0;
      const value = parseCurrency(match[3]);
      
      if (value > 0 && name.length > 1) {
        result.holdings.push({
          name,
          ticker: name.length <= 5 ? name : null,
          shares,
          value,
          price: shares > 0 ? Math.round((value / shares) * 100) / 100 : 0,
          type: 'mutual_fund'
        });
      }
    }
  }
  
  // Extract YTD contributions
  const contribPattern = /(?:ytd|year[\s-]*to[\s-]*date)\s*contributions?[:\s]*\$?([\d,]+\.?\d*)/i;
  const contribMatch = text.match(contribPattern);
  if (contribMatch) {
    result.contributions.ytd = parseCurrency(contribMatch[1]);
  }
  
  // Extract employer match
  const matchPattern = /employer\s*(?:match|contribution)[:\s]*\$?([\d,]+\.?\d*)/i;
  const matchMatch = text.match(matchPattern);
  if (matchMatch) {
    result.contributions.employerMatch = parseCurrency(matchMatch[1]);
  }
  
  return result;
}

// Parse Robinhood brokerage statement
function parseRobinhood(text) {
  const result = {
    statementDate: null,
    totalBalance: 0,
    holdings: [],
    cashBalance: 0,
    assetAllocation: {}
  };
  
  // Extract statement date
  const datePatterns = [
    /statement\s*(?:date|period)[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
    /(?:as of|ending)\s*(\w+\s+\d{1,2},?\s*\d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/
  ];
  result.statementDate = extractDate(text, datePatterns);
  
  // Extract total portfolio value
  const valuePatterns = [
    /(?:total|portfolio)\s*(?:value|equity)[:\s]*\$?([\d,]+\.?\d*)/i,
    /(?:account|ending)\s*(?:balance|value)[:\s]*\$?([\d,]+\.?\d*)/i
  ];
  
  for (const pattern of valuePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.totalBalance = parseCurrency(match[1]);
      if (result.totalBalance > 0) break;
    }
  }
  
  // Extract cash balance
  const cashPattern = /(?:cash|buying\s*power)[:\s]*\$?([\d,]+\.?\d*)/i;
  const cashMatch = text.match(cashPattern);
  if (cashMatch) {
    result.cashBalance = parseCurrency(cashMatch[1]);
  }
  
  // Extract stock holdings - ticker, shares, price, value
  const holdingPattern = /([A-Z]{1,5})\s+([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)/g;
  let match;
  while ((match = holdingPattern.exec(text)) !== null) {
    const ticker = match[1];
    const shares = parseFloat(match[2].replace(/,/g, '')) || 0;
    const price = parseCurrency(match[3]);
    const value = parseCurrency(match[4]);
    
    if (ticker.length >= 1 && ticker.length <= 5 && value > 0) {
      result.holdings.push({
        name: ticker,
        ticker,
        shares,
        price,
        value,
        type: 'stock'
      });
    }
  }
  
  return result;
}

// Parse Wealthfront HYSA statement
function parseWealthfrontHYSA(text) {
  const result = {
    statementDate: null,
    totalBalance: 0,
    holdings: [],
    interestEarned: 0,
    apy: 0,
    assetAllocation: { cash: 0 }
  };
  
  // Extract statement date
  const datePatterns = [
    /(?:statement\s*(?:date|period)|as of)[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
    /(\w+\s+\d{4})\s*statement/i,
    /(?:ending|through)\s*(\w+\s+\d{1,2},?\s*\d{4})/i
  ];
  result.statementDate = extractDate(text, datePatterns);
  
  // Extract balance
  const balancePatterns = [
    /(?:ending|current|account)\s*balance[:\s]*\$?([\d,]+\.?\d*)/i,
    /(?:total|available)\s*(?:balance|cash)[:\s]*\$?([\d,]+\.?\d*)/i,
    /balance[:\s]*\$?([\d,]+\.?\d*)/i
  ];
  
  for (const pattern of balancePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.totalBalance = parseCurrency(match[1]);
      if (result.totalBalance > 0) break;
    }
  }
  
  result.assetAllocation.cash = result.totalBalance;
  
  // Extract APY
  const apyPattern = /(\d+\.?\d*)\s*%\s*apy/i;
  const apyMatch = text.match(apyPattern);
  if (apyMatch) {
    result.apy = parseFloat(apyMatch[1]);
  }
  
  // Extract interest earned
  const interestPattern = /interest\s*(?:earned|paid)[:\s]*\$?([\d,]+\.?\d*)/i;
  const interestMatch = text.match(interestPattern);
  if (interestMatch) {
    result.interestEarned = parseCurrency(interestMatch[1]);
  }
  
  // HYSA is just cash
  result.holdings.push({
    name: 'Cash',
    ticker: null,
    shares: 1,
    price: result.totalBalance,
    value: result.totalBalance,
    type: 'cash'
  });
  
  return result;
}

// Parse Wealthfront IRA (Roth or Traditional)
function parseWealthfrontIRA(text) {
  const result = {
    statementDate: null,
    totalBalance: 0,
    holdings: [],
    contributions: {},
    assetAllocation: {}
  };
  
  // Extract statement date
  const datePatterns = [
    /(?:statement\s*(?:date|period)|as of)[:\s]*(\w+\s+\d{1,2},?\s*\d{4})/i,
    /(\w+\s+\d{4})\s*statement/i
  ];
  result.statementDate = extractDate(text, datePatterns);
  
  // Extract total balance
  const balancePatterns = [
    /(?:account|portfolio|total)\s*(?:value|balance)[:\s]*\$?([\d,]+\.?\d*)/i,
    /(?:ending|current)\s*(?:balance|value)[:\s]*\$?([\d,]+\.?\d*)/i
  ];
  
  for (const pattern of balancePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.totalBalance = parseCurrency(match[1]);
      if (result.totalBalance > 0) break;
    }
  }
  
  // Extract ETF holdings (Wealthfront uses ETFs)
  // Look for patterns like: VTI 45.123 $245.50 $11,076.42
  const holdingPattern = /([A-Z]{2,5})\s+([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)/g;
  let match;
  while ((match = holdingPattern.exec(text)) !== null) {
    const ticker = match[1];
    const shares = parseFloat(match[2].replace(/,/g, '')) || 0;
    const price = parseCurrency(match[3]);
    const value = parseCurrency(match[4]);
    
    if (ticker.length >= 2 && ticker.length <= 5 && value > 0) {
      result.holdings.push({
        name: ticker,
        ticker,
        shares,
        price,
        value,
        type: 'etf'
      });
    }
  }
  
  // Also look for ETF allocations by percentage
  const allocationPattern = /([A-Z]{2,5})\s*[-–]\s*[\w\s]+\s+(\d+\.?\d*)%/g;
  while ((match = allocationPattern.exec(text)) !== null) {
    const ticker = match[1];
    const percentage = parseFloat(match[2]) / 100;
    if (!result.holdings.find(h => h.ticker === ticker)) {
      result.holdings.push({
        name: ticker,
        ticker,
        shares: 0,
        price: 0,
        value: Math.round(result.totalBalance * percentage * 100) / 100,
        percentage,
        type: 'etf'
      });
    }
  }
  
  // Extract YTD contributions
  const contribPattern = /(?:ytd|year[\s-]*to[\s-]*date)\s*contributions?[:\s]*\$?([\d,]+\.?\d*)/i;
  const contribMatch = text.match(contribPattern);
  if (contribMatch) {
    result.contributions.ytd = parseCurrency(contribMatch[1]);
  }
  
  return result;
}

// Main parser function
async function parseStatement(filePath, showRaw = false) {
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  
  const dataBuffer = fs.readFileSync(absolutePath);
  const pdfData = await pdfParse(dataBuffer);
  const text = pdfData.text;
  
  if (showRaw) {
    console.log('\n📄 RAW TEXT OUTPUT:');
    console.log('═'.repeat(60));
    console.log(text);
    console.log('═'.repeat(60));
  }
  
  // Detect statement type
  const statementType = detectStatementType(text);
  
  // Parse based on type
  let parsedData;
  switch (statementType.type) {
    case 'fidelity_401k':
    case 'vanguard_401k':
      parsedData = parseFidelity401k(text);
      break;
    case 'robinhood':
      parsedData = parseRobinhood(text);
      break;
    case 'wealthfront_hysa':
      parsedData = parseWealthfrontHYSA(text);
      break;
    case 'wealthfront_roth':
    case 'wealthfront_traditional_ira':
      parsedData = parseWealthfrontIRA(text);
      break;
    default:
      // Try generic parsing
      parsedData = parseGeneric(text);
  }
  
  // Look for and mask any account numbers
  const accountPattern = /(?:account\s*(?:#|number|no\.?)?)[:\s]*([A-Z0-9-]{6,})/gi;
  let accountMatch;
  const maskedAccounts = [];
  while ((accountMatch = accountPattern.exec(text)) !== null) {
    maskedAccounts.push(maskAccountNumber(accountMatch[1]));
  }
  
  return {
    file: path.basename(filePath),
    pdfInfo: {
      pages: pdfData.numpages,
      characters: text.length
    },
    statementType: statementType.type,
    custodian: statementType.custodian,
    accountType: statementType.accountType,
    taxTreatment: statementType.taxTreatment,
    maskedAccountRefs: maskedAccounts.length > 0 ? maskedAccounts : null,
    ...parsedData
  };
}

// Generic parser for unknown statement types
function parseGeneric(text) {
  const result = {
    statementDate: null,
    totalBalance: 0,
    holdings: [],
    assetAllocation: {}
  };
  
  // Try to find any date
  const dateMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{4})|(\w+\s+\d{1,2},?\s*\d{4})/);
  if (dateMatch) {
    const parsed = new Date(dateMatch[0]);
    if (!isNaN(parsed.getTime())) {
      result.statementDate = parsed.toISOString().split('T')[0];
    }
  }
  
  // Try to find any balance
  const balanceMatch = text.match(/\$?([\d,]+\.?\d*)/g);
  if (balanceMatch) {
    // Find the largest number that looks like a balance
    const values = balanceMatch.map(v => parseCurrency(v)).filter(v => v > 100);
    if (values.length > 0) {
      result.totalBalance = Math.max(...values);
    }
  }
  
  return result;
}

// Display results
function displayResults(data) {
  console.log('\n💰 Investment Statement Parser (TEST MODE)');
  console.log('═'.repeat(60));
  
  console.log(`\nFile: ${data.file}`);
  
  console.log('\n📋 PDF Information:');
  console.log(`   Pages: ${data.pdfInfo.pages}`);
  console.log(`   Characters: ${data.pdfInfo.characters}`);
  
  console.log('\n🏦 ACCOUNT DETECTION:');
  console.log('─'.repeat(40));
  console.log(`   Statement Type: ${data.statementType}`);
  console.log(`   Custodian: ${data.custodian}`);
  console.log(`   Account Type: ${data.accountType}`);
  console.log(`   Tax Treatment: ${data.taxTreatment}`);
  if (data.maskedAccountRefs) {
    console.log(`   Account Refs (masked): ${data.maskedAccountRefs.join(', ')}`);
  }
  
  console.log('\n📅 STATEMENT INFO:');
  console.log('─'.repeat(40));
  console.log(`   Statement Date: ${data.statementDate || 'Not found'}`);
  console.log(`   Total Balance: $${data.totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  
  if (data.apy) {
    console.log(`   APY: ${data.apy}%`);
  }
  if (data.interestEarned) {
    console.log(`   Interest Earned: $${data.interestEarned.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  }
  if (data.cashBalance) {
    console.log(`   Cash Balance: $${data.cashBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  }
  
  if (data.contributions && Object.keys(data.contributions).length > 0) {
    console.log('\n💵 CONTRIBUTIONS:');
    console.log('─'.repeat(40));
    if (data.contributions.ytd) {
      console.log(`   YTD Contributions: $${data.contributions.ytd.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
    if (data.contributions.employerMatch) {
      console.log(`   Employer Match: $${data.contributions.employerMatch.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }
  
  if (data.holdings && data.holdings.length > 0) {
    console.log('\n📊 HOLDINGS:');
    console.log('─'.repeat(60));
    console.log('   Name/Ticker          Shares      Price        Value');
    console.log('   ' + '─'.repeat(56));
    
    for (const holding of data.holdings) {
      const name = (holding.ticker || holding.name).substring(0, 18).padEnd(18);
      const shares = holding.shares.toLocaleString('en-US', { minimumFractionDigits: 2 }).padStart(10);
      const price = `$${holding.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}`.padStart(10);
      const value = `$${holding.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`.padStart(12);
      console.log(`   ${name} ${shares} ${price} ${value}`);
    }
    
    const holdingsTotal = data.holdings.reduce((sum, h) => sum + h.value, 0);
    console.log('   ' + '─'.repeat(56));
    console.log(`   ${'Total'.padEnd(18)} ${''.padStart(10)} ${''.padStart(10)} $${holdingsTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`.padStart(12));
  }
  
  // Prepare data for storage
  const storageData = {
    custodian: data.custodian,
    accountType: data.accountType,
    taxTreatment: data.taxTreatment,
    snapshotDate: data.statementDate,
    totalBalance: data.totalBalance,
    holdings: data.holdings || [],
    isProjected: false,
    sourceStatement: data.file,
    contributions: data.contributions || {},
    additionalInfo: {}
  };
  
  if (data.apy) storageData.additionalInfo.apy = data.apy;
  if (data.interestEarned) storageData.additionalInfo.interestEarned = data.interestEarned;
  if (data.cashBalance) storageData.additionalInfo.cashBalance = data.cashBalance;
  
  console.log('\n' + '═'.repeat(60));
  console.log('📦 DATA READY FOR STORAGE:');
  console.log('─'.repeat(60));
  console.log(JSON.stringify(storageData, null, 2));
  
  return storageData;
}

// Parse all statements in folder
async function parseAllStatements(folderPath) {
  const statementsDir = path.resolve(folderPath);
  const files = fs.readdirSync(statementsDir).filter(f => f.endsWith('.pdf'));
  
  console.log(`\n📁 Found ${files.length} PDF files in ${statementsDir}\n`);
  
  const results = [];
  for (const file of files) {
    try {
      console.log(`\n${'═'.repeat(70)}`);
      console.log(`Processing: ${file}`);
      const data = await parseStatement(path.join(statementsDir, file));
      results.push(displayResults(data));
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }
  
  // Summary
  console.log('\n\n' + '═'.repeat(70));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(70));
  
  const byTaxTreatment = {
    taxable: { accounts: [], total: 0 },
    tax_free: { accounts: [], total: 0 },
    tax_deferred: { accounts: [], total: 0 }
  };
  
  for (const result of results) {
    if (result.taxTreatment && byTaxTreatment[result.taxTreatment]) {
      byTaxTreatment[result.taxTreatment].accounts.push({
        custodian: result.custodian,
        type: result.accountType,
        balance: result.totalBalance
      });
      byTaxTreatment[result.taxTreatment].total += result.totalBalance;
    }
  }
  
  console.log('\n💰 By Tax Treatment:');
  console.log('─'.repeat(50));
  
  for (const [treatment, data] of Object.entries(byTaxTreatment)) {
    if (data.accounts.length > 0) {
      console.log(`\n   ${treatment.toUpperCase().replace('_', ' ')}:`);
      for (const acc of data.accounts) {
        console.log(`      ${acc.custodian} ${acc.type}: $${acc.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      }
      console.log(`      ─────────────────────────────────`);
      console.log(`      Subtotal: $${data.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }
  
  const grandTotal = Object.values(byTaxTreatment).reduce((sum, d) => sum + d.total, 0);
  console.log('\n' + '═'.repeat(50));
  console.log(`   GRAND TOTAL: $${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  
  return results;
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npm run parse-investment -- ./statements/filename.pdf');
    console.log('  npm run parse-investment -- ./statements/filename.pdf --raw');
    console.log('  npm run parse-investment -- --all');
    process.exit(1);
  }
  
  try {
    if (args.includes('--all')) {
      const statementsFolder = path.join(__dirname, '..', 'statements');
      await parseAllStatements(statementsFolder);
    } else {
      const filePath = args[0];
      const showRaw = args.includes('--raw');
      const data = await parseStatement(filePath, showRaw);
      displayResults(data);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();
