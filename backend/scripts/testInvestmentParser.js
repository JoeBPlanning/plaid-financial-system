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

// Statement type detection patterns - ORDER MATTERS (most specific first)
const STATEMENT_PATTERNS = {
  wealthfront_roth: {
    patterns: [/wealthfront/i, /roth\s*ira/i],
    requiredMatches: 2,
    custodian: 'Wealthfront',
    accountType: 'Roth_IRA',
    taxTreatment: 'tax_free'
  },
  wealthfront_traditional_ira: {
    patterns: [/wealthfront/i, /traditional\s*ira/i],
    requiredMatches: 2,
    custodian: 'Wealthfront',
    accountType: 'Traditional_IRA',
    taxTreatment: 'tax_deferred'
  },
  wealthfront_hysa: {
    patterns: [/wealthfront/i, /(?:individual\s*)?cash\s*account|bank\s*sweep/i],
    requiredMatches: 2,
    custodian: 'Wealthfront',
    accountType: 'HYSA',
    taxTreatment: 'taxable'
  },
  wealthfront_brokerage: {
    patterns: [/wealthfront/i, /individual\s*(?:brokerage|taxable)/i],
    requiredMatches: 2,
    custodian: 'Wealthfront',
    accountType: 'brokerage',
    taxTreatment: 'taxable'
  },
  fidelity_401k: {
    patterns: [/fidelity/i, /401\s*\(?\s*k\s*\)?/i],
    requiredMatches: 2,
    custodian: 'Fidelity',
    accountType: '401k',
    taxTreatment: 'tax_deferred'
  },
  fidelity_roth_ira: {
    patterns: [/fidelity/i, /roth\s*ira/i],
    requiredMatches: 2,
    custodian: 'Fidelity',
    accountType: 'Roth_IRA',
    taxTreatment: 'tax_free'
  },
  fidelity_ira: {
    patterns: [/fidelity/i, /(?:traditional\s*)?ira/i],
    requiredMatches: 2,
    custodian: 'Fidelity',
    accountType: 'Traditional_IRA',
    taxTreatment: 'tax_deferred'
  },
  vanguard_401k: {
    patterns: [/vanguard/i, /401\s*\(?\s*k\s*\)?/i],
    requiredMatches: 2,
    custodian: 'Vanguard',
    accountType: '401k',
    taxTreatment: 'tax_deferred'
  },
  robinhood: {
    patterns: [/robinhood\s*(?:securities|markets|financial)/i, /(?:monthly|account)\s*statement/i],
    requiredMatches: 2,
    custodian: 'Robinhood',
    accountType: 'brokerage',
    taxTreatment: 'taxable'
  },
  schwab_brokerage: {
    patterns: [/charles\s*schwab|schwab/i, /brokerage/i],
    requiredMatches: 2,
    custodian: 'Schwab',
    accountType: 'brokerage',
    taxTreatment: 'taxable'
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
  
  // Extract statement date from "11/01/2025 to 11/30/2025"
  const periodMatch = text.match(/(\d{2})\/\d{2}\/(\d{4})\s*to\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (periodMatch) {
    result.statementDate = `${periodMatch[5]}-${periodMatch[3]}-${periodMatch[4]}`;
  }
  
  // Extract total portfolio value - look for "Portfolio Value" followed by amounts
  // Format: Portfolio Value $1,724.37 $1,733.35 (opening/closing)
  const portfolioMatch = text.match(/Portfolio\s*Value[\s\n]*\$([\d,]+\.?\d*)[\s\n]*\$([\d,]+\.?\d*)/i);
  if (portfolioMatch) {
    result.totalBalance = parseCurrency(portfolioMatch[2]); // Use closing balance
  }
  
  // Also try "Total Priced Portfolio"
  if (result.totalBalance === 0) {
    const totalMatch = text.match(/Total\s*Priced\s*Portfolio[\s\n]*\$([\d,]+\.?\d*)/i);
    if (totalMatch) {
      result.totalBalance = parseCurrency(totalMatch[1]);
    }
  }
  
  // Extract cash balance from "Brokerage Cash Balance"
  const cashMatch = text.match(/Brokerage\s*Cash\s*Balance[\s\n]*\$([\d,]+\.?\d*)/i);
  if (cashMatch) {
    result.cashBalance = parseCurrency(cashMatch[1]);
  }
  
  // Extract stock holdings from Robinhood format
  // Pattern: TICKER Margin QTY $PRICE $VALUE
  // Example: AMZN Margin 0.332299 $233.2200 $77.50
  const holdingPattern = /([A-Z]{1,5})Margin([\d.]+)\$([\d,.]+)\$([\d,.]+)/g;
  let match;
  while ((match = holdingPattern.exec(text)) !== null) {
    const ticker = match[1];
    const shares = parseFloat(match[2]) || 0;
    const price = parseCurrency(match[3]);
    const value = parseCurrency(match[4]);
    
    if (ticker.length >= 1 && ticker.length <= 5 && value > 0 && shares > 0) {
      // Avoid duplicates and filter out non-ticker patterns
      if (!result.holdings.find(h => h.ticker === ticker) && 
          !['CDIV', 'BUY', 'SELL'].includes(ticker)) {
        result.holdings.push({
          name: ticker,
          ticker,
          shares: Math.round(shares * 1000000) / 1000000, // 6 decimal places
          price,
          value,
          type: ticker.length <= 4 ? 'stock' : 'etf'
        });
      }
    }
  }
  
  // Calculate asset allocation
  let equityValue = 0;
  let etfValue = 0;
  
  for (const holding of result.holdings) {
    if (['IGIB', 'SCHD', 'VOO', 'QQQM'].includes(holding.ticker)) {
      etfValue += holding.value;
    } else {
      equityValue += holding.value;
    }
  }
  
  result.assetAllocation = {
    stocks: Math.round(equityValue * 100) / 100,
    etfs: Math.round(etfValue * 100) / 100,
    cash: result.cashBalance
  };
  
  return result;
}

// Parse Wealthfront HYSA/Cash Account statement
function parseWealthfrontHYSA(text) {
  const result = {
    statementDate: null,
    totalBalance: 0,
    holdings: [],
    interestEarned: 0,
    apy: 0,
    assetAllocation: { cash: 0 }
  };
  
  // Extract statement date from "Monthly Statement for October 1 - 31, 2025"
  const periodMatch = text.match(/Monthly\s*Statement\s*for\s*(\w+)\s*\d+\s*[-–]\s*\d+,?\s*(\d{4})/i);
  if (periodMatch) {
    const month = periodMatch[1];
    const year = periodMatch[2];
    // Get last day of month for statement date
    const monthNum = new Date(`${month} 1, ${year}`).getMonth();
    const lastDay = new Date(year, monthNum + 1, 0).getDate();
    result.statementDate = `${year}-${String(monthNum + 1).padStart(2, '0')}-${lastDay}`;
  }
  
  // Extract balance - look for "Ending Balance" followed by amount
  const endingBalanceMatch = text.match(/Ending\s*Balance[\s\n]*\$?([\d,]+\.?\d*)/i);
  if (endingBalanceMatch) {
    result.totalBalance = parseCurrency(endingBalanceMatch[1]);
  }
  
  // Also try "Total Holdings"
  if (result.totalBalance === 0) {
    const totalHoldingsMatch = text.match(/Total\s*Holdings[\s\n]*\$?([\d,]+\.?\d*)/i);
    if (totalHoldingsMatch) {
      result.totalBalance = parseCurrency(totalHoldingsMatch[1]);
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
  const interestPattern = /interest[\s\n]*\$?([\d,]+\.?\d*)/i;
  const interestMatch = text.match(interestPattern);
  if (interestMatch && parseCurrency(interestMatch[1]) < result.totalBalance) {
    result.interestEarned = parseCurrency(interestMatch[1]);
  }
  
  // HYSA is just cash
  result.holdings.push({
    name: 'Cash (HYSA)',
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
  
  // Extract statement date from "Monthly Statement for November 1 - 30, 2025"
  const periodMatch = text.match(/Monthly\s*Statement\s*for\s*(\w+)\s*\d+\s*[-–]\s*(\d+),?\s*(\d{4})/i);
  if (periodMatch) {
    const month = periodMatch[1];
    const day = periodMatch[2];
    const year = periodMatch[3];
    const monthNum = new Date(`${month} 1, ${year}`).getMonth() + 1;
    result.statementDate = `${year}-${String(monthNum).padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Extract total balance - look for "Ending Balance" or "Total Holdings"
  const endingBalanceMatch = text.match(/Ending\s*Balance[\s\n]*\$?([\d,]+\.?\d*)/i);
  if (endingBalanceMatch) {
    result.totalBalance = parseCurrency(endingBalanceMatch[1]);
  }
  
  // Also try "Total Holdings" as backup
  const totalHoldingsMatch = text.match(/Total\s*Holdings[\s\n]*\$?([\d,]+\.?\d*)/i);
  if (totalHoldingsMatch) {
    const holdingsTotal = parseCurrency(totalHoldingsMatch[1]);
    if (holdingsTotal > result.totalBalance) {
      result.totalBalance = holdingsTotal;
    }
  }
  
  // Extract ETF holdings from Wealthfront format
  // Look for patterns like: VTI 15 $336.31 $5,044.65 or with decimal shares
  // Pattern: TICKER SHARES $PRICE $VALUE
  const holdingPattern = /([A-Z]{2,5})\s+([\d.]+)\s+\$([\d,.]+)\s+\$([\d,.]+)/g;
  let match;
  while ((match = holdingPattern.exec(text)) !== null) {
    const ticker = match[1];
    const shares = parseFloat(match[2]) || 0;
    const price = parseCurrency(match[3]);
    const value = parseCurrency(match[4]);
    
    // Validate: ticker should be 2-5 uppercase letters, value should be reasonable
    if (ticker.length >= 2 && ticker.length <= 5 && value > 0 && shares > 0) {
      // Avoid duplicates
      if (!result.holdings.find(h => h.ticker === ticker)) {
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
  }
  
  // Calculate asset allocation from holdings
  let stockValue = 0;
  let bondValue = 0;
  let cashValue = 0;
  
  const stockETFs = ['VTI', 'VEA', 'VWO', 'VNQ', 'SCHB', 'SCHA', 'SCHF', 'SCHE'];
  const bondETFs = ['LQD', 'SCHP', 'BND', 'AGG', 'TIP', 'VTIP'];
  const cashETFs = ['TIMXX', 'VMFXX'];
  
  for (const holding of result.holdings) {
    if (stockETFs.includes(holding.ticker)) {
      stockValue += holding.value;
    } else if (bondETFs.includes(holding.ticker)) {
      bondValue += holding.value;
    } else if (cashETFs.includes(holding.ticker)) {
      cashValue += holding.value;
    } else {
      stockValue += holding.value; // Default to stocks
    }
  }
  
  result.assetAllocation = {
    stocks: Math.round(stockValue * 100) / 100,
    bonds: Math.round(bondValue * 100) / 100,
    cash: Math.round(cashValue * 100) / 100
  };
  
  // If total balance is still 0, calculate from holdings
  if (result.totalBalance === 0 && result.holdings.length > 0) {
    result.totalBalance = result.holdings.reduce((sum, h) => sum + h.value, 0);
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
