#!/usr/bin/env node
/**
 * OCR Investment Statement Parser
 * Uses Tesseract.js for OCR on image-based PDFs (like Fidelity 401k statements)
 * 
 * Usage:
 *   npm run ocr-investment -- ./statements/filename.pdf
 *   npm run ocr-investment -- ./statements/filename.pdf --raw
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Tesseract = require('tesseract.js');
const os = require('os');

// Utility: Parse currency string to number
function parseCurrency(str) {
  if (!str) return 0;
  const cleaned = str.toString().replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Utility: Mask account number
function maskAccountNumber(accountNum) {
  if (!accountNum) return null;
  const cleaned = accountNum.toString().replace(/\D/g, '');
  if (cleaned.length <= 4) return '****';
  return '****' + cleaned.slice(-4);
}

// Convert PDF to images using pdftoppm (poppler)
async function pdfToImages(pdfPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-ocr-'));
  const outputPrefix = path.join(tempDir, 'page');
  
  console.log('   Converting PDF to images using pdftoppm...');
  
  try {
    // Use pdftoppm to convert PDF to PNG images (300 DPI for good OCR)
    execFileSync('pdftoppm', ['-png', '-r', '300', pdfPath, outputPrefix], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Read the generated images
    const files = fs.readdirSync(tempDir)
      .filter(f => f.endsWith('.png'))
      .sort();
    
    console.log(`   Converted ${files.length} pages to images`);
    
    const images = files.map((file, index) => {
      const imagePath = path.join(tempDir, file);
      return {
        pageNum: index + 1,
        buffer: fs.readFileSync(imagePath),
        path: imagePath
      };
    });
    
    return { images, tempDir };
  } catch (error) {
    // Cleanup on error
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

// Run OCR on images
async function runOCR(images) {
  console.log('   Running OCR (this may take a minute)...');
  
  const worker = await Tesseract.createWorker('eng');
  const results = [];
  
  for (const image of images) {
    const { data: { text } } = await worker.recognize(image.buffer);
    results.push({
      pageNum: image.pageNum,
      text: text
    });
    process.stdout.write(`\r   Page ${image.pageNum}/${images.length} OCR complete`);
  }
  console.log('');
  
  await worker.terminate();
  
  return results;
}

// Parse Fidelity 401k statement
function parseFidelity401k(text) {
  const result = {
    statementDate: null,
    accounts: [],
    totalBalance: 0,
    holdings: [],
    contributions: {},
    vesting: {}
  };
  
  // Extract statement date from "Statement Period: 01/01/2025 to 12/11/2025"
  const periodMatch = text.match(/Statement\s*Period[:\s]*\d{1,2}\/\d{1,2}\/\d{4}\s*to\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (periodMatch) {
    result.statementDate = `${periodMatch[3]}-${periodMatch[1].padStart(2, '0')}-${periodMatch[2].padStart(2, '0')}`;
  }
  
  // Extract total/ending balance
  const endingMatch = text.match(/Ending\s*Balance[:\s]*\$?([\d,]+\.?\d*)/i);
  if (endingMatch) {
    result.totalBalance = parseCurrency(endingMatch[1]);
  }
  
  // Extract vested balance
  const vestedMatch = text.match(/Vested\s*Balance[:\s]*\$?([\d,]+\.?\d*)/i);
  if (vestedMatch) {
    result.vesting.vestedBalance = parseCurrency(vestedMatch[1]);
  }
  
  // Extract YTD contributions from Account Summary section
  const yourContribMatch = text.match(/Your\s*Contributions[:\s]*\$?([\d,]+\.?\d*)/i);
  if (yourContribMatch) {
    result.contributions.employee = parseCurrency(yourContribMatch[1]);
  }
  
  const employerContribMatch = text.match(/Employer\s*Contributions[:\s]*\$?([\d,]+\.?\d*)/i);
  if (employerContribMatch) {
    result.contributions.employer = parseCurrency(employerContribMatch[1]);
  }
  
  const rolloverContribMatch = text.match(/(?:Your\s*)?Rollover\s*Contributions[:\s]*\$?([\d,]+\.?\d*)/i);
  if (rolloverContribMatch) {
    result.contributions.rollover = parseCurrency(rolloverContribMatch[1]);
  }
  
  // Extract account breakdown from "Your Contribution Summary" section
  // OCR often splits lines, so we need flexible patterns
  // Format varies: "Employee 0\nDeferral $5,972.87 $13,815.08 100% $73,538.82 $73,538.82"
  // We want the 4th dollar amount (Total Account Balance)
  
  // First, try to find the Contribution Summary section and normalize it
  const contribSection = text.match(/Your\s*Contribution\s*Summary[\s\S]*?(?=Your\s*Account\s*Activity|$)/i);
  const searchText = contribSection ? contribSection[0].replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ') : text;
  
  const accountPatterns = [
    // Employee Deferral - may be split as "Employee 0 Deferral" or "Employee\nDeferral"
    { 
      pattern: /Employee\s*(?:0\s*)?Deferral\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)\s*\d+%?\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/i, 
      name: 'Employee Deferral', 
      taxType: 'tax_deferred',
      balanceIndex: 3  // 4th dollar amount (0-indexed as 3)
    },
    // Profit Sharing - may have OCR artifacts like ! ' '
    { 
      pattern: /Profit\s*(?:Sharing)?[^$]*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)\s*\d+%?\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/i, 
      name: 'Profit Sharing', 
      taxType: 'tax_deferred',
      balanceIndex: 3
    },
    // Rollover
    { 
      pattern: /(?<!Your\s)(?<!Contributions\s)Rollover\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)\s*\d+%?\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/i, 
      name: 'Rollover', 
      taxType: 'tax_deferred',
      balanceIndex: 3
    },
    // Roth Deferral - may be split
    { 
      pattern: /Roth\s*(?:Deferral)?[^$]*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)\s*\d+%?\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/i, 
      name: 'Roth Deferral', 
      taxType: 'tax_free',
      balanceIndex: 3
    },
    // Employer Match
    { 
      pattern: /(?:Employer|Company)\s*Match[^$]*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)\s*\d+%?\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/i, 
      name: 'Employer Match', 
      taxType: 'tax_deferred',
      balanceIndex: 3
    },
    // Safe Harbor
    { 
      pattern: /Safe\s*Harbor[^$]*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)\s*\d+%?\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/i, 
      name: 'Safe Harbor', 
      taxType: 'tax_deferred',
      balanceIndex: 3
    },
    // After Tax
    { 
      pattern: /After[\s-]*Tax[^$]*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)\s*\d+%?\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/i, 
      name: 'After-Tax', 
      taxType: 'taxable',
      balanceIndex: 3
    },
    // Roth Rollover  
    { 
      pattern: /Roth\s*Rollover[^$]*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)\s*\d+%?\s*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/i, 
      name: 'Roth Rollover', 
      taxType: 'tax_free',
      balanceIndex: 3
    }
  ];
  
  for (const acct of accountPatterns) {
    const match = searchText.match(acct.pattern);
    if (match) {
      // Get the balance from the correct index (Total Account Balance)
      const balance = parseCurrency(match[acct.balanceIndex + 1]); // +1 because match[0] is full match
      if (balance > 0) {
        // Avoid duplicates
        if (!result.accounts.find(a => a.name === acct.name)) {
          result.accounts.push({
            name: acct.name,
            balance,
            taxType: acct.taxType
          });
        }
      }
    }
  }
  
  // Extract fund holdings from "Market Value of Your Account" section
  // OCR format: "FID Blue Chip GR K6 273.354 438.572 36.83 44.77 10,067.63 19,634.87"
  // The last two dollar amounts are: previous value, current value
  
  const marketValueSection = text.match(/Market\s*Value\s*of\s*Your\s*Account[\s\S]*?(?=Your\s*Contribution\s*Elections|$)/i);
  const holdingsText = marketValueSection ? marketValueSection[0].replace(/[\n\r]+/g, ' ') : text;
  
  // Look for specific fund patterns with their values
  const fundNames = [
    { pattern: /FID\s*Blue\s*Chip\s*G?R?\s*K6?/gi, name: 'FID Blue Chip GR K6' },
    { pattern: /FID\s*Freedom\s*2045\s*K6?/gi, name: 'FID Freedom 2045 K6' },
    { pattern: /FID\s*Freedom\s*2040\s*K6?/gi, name: 'FID Freedom 2040 K6' },
    { pattern: /FID\s*Freedom\s*2050\s*K6?/gi, name: 'FID Freedom 2050 K6' },
    { pattern: /FID\s*500\s*INDEX/gi, name: 'FID 500 Index' },
    { pattern: /FID\s*CONTRAFUND\s*K6?/gi, name: 'FID Contrafund K6' }
  ];
  
  // Extract all dollar amounts after each fund name
  for (const fund of fundNames) {
    const fundMatch = holdingsText.match(new RegExp(fund.pattern.source + '[^$]*\\$?([\\d,]+\\.?\\d*)\\s*\\$?([\\d,]+\\.?\\d*)', 'i'));
    if (fundMatch) {
      // The last dollar amount is typically the current market value
      const value = parseCurrency(fundMatch[2]) || parseCurrency(fundMatch[1]);
      
      if (value > 100 && !result.holdings.find(h => h.name === fund.name)) {
        result.holdings.push({
          name: fund.name,
          ticker: null,
          value,
          type: 'mutual_fund'
        });
      }
    }
  }
  
  // If we still don't have holdings, try a more generic pattern
  if (result.holdings.length === 0) {
    const genericPattern = /FID\s+([A-Za-z0-9\s]+?(?:K6|K|INDEX))[^\d]*[\d,.]+\s+[\d,.]+[^\$]*\$?([\d,]+\.?\d*)\s*\$?([\d,]+\.?\d*)/gi;
    let match;
    while ((match = genericPattern.exec(holdingsText)) !== null) {
      const name = 'FID ' + match[1].trim().replace(/\s+/g, ' ');
      const value = parseCurrency(match[3]) || parseCurrency(match[2]);
      
      if (value > 100 && !result.holdings.find(h => Math.abs(h.value - value) < 1)) {
        result.holdings.push({
          name,
          ticker: null,
          value,
          type: 'mutual_fund'
        });
      }
    }
  }
  
  // If no accounts found but we have total balance, create a generic entry
  if (result.accounts.length === 0 && result.totalBalance > 0) {
    result.accounts.push({
      name: '401k Total',
      balance: result.totalBalance,
      taxType: 'tax_deferred'
    });
  }
  
  // If total balance is 0 but we have accounts, sum them
  if (result.totalBalance === 0 && result.accounts.length > 0) {
    result.totalBalance = result.accounts.reduce((sum, a) => sum + a.balance, 0);
  }
  
  // Calculate vesting percentage if we have both values
  if (result.vesting.vestedBalance && result.totalBalance > 0) {
    result.vesting.percentage = Math.round((result.vesting.vestedBalance / result.totalBalance) * 100);
  }
  
  return result;
}

// Main parser function
async function parseStatement(filePath, showRaw = false) {
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  
  console.log(`\n📄 Processing: ${path.basename(filePath)}`);
  console.log('─'.repeat(50));
  
  // Convert PDF to images
  const { images, tempDir } = await pdfToImages(absolutePath);
  
  let ocrResults;
  try {
    // Run OCR
    ocrResults = await runOCR(images);
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  
  // Combine all text
  const fullText = ocrResults.map(r => r.text).join('\n\n--- PAGE BREAK ---\n\n');
  
  if (showRaw) {
    console.log('\n📄 RAW OCR TEXT OUTPUT:');
    console.log('═'.repeat(60));
    console.log(fullText);
    console.log('═'.repeat(60));
  }
  
  // Detect if this is a Fidelity 401k statement
  const isFidelity = /fidelity|netbenefits/i.test(fullText);
  const is401k = /401\s*\(?\s*k\s*\)?/i.test(fullText);
  
  let parsedData;
  let statementType = 'unknown';
  let custodian = 'Unknown';
  let accountType = 'Unknown';
  
  if (isFidelity && is401k) {
    statementType = 'fidelity_401k';
    custodian = 'Fidelity';
    accountType = '401k';
    parsedData = parseFidelity401k(fullText);
  } else if (is401k) {
    statementType = 'generic_401k';
    custodian = 'Unknown';
    accountType = '401k';
    parsedData = parseFidelity401k(fullText); // Use same parser
  } else {
    parsedData = {
      statementDate: null,
      accounts: [],
      totalBalance: 0,
      holdings: [],
      contributions: {},
      vesting: {}
    };
  }
  
  // Look for account numbers and mask them
  const accountPattern = /(?:account\s*(?:#|number|no\.?)?)[:\s]*([A-Z0-9-]{6,})/gi;
  let accountMatch;
  const maskedAccounts = [];
  while ((accountMatch = accountPattern.exec(fullText)) !== null) {
    maskedAccounts.push(maskAccountNumber(accountMatch[1]));
  }
  
  return {
    file: path.basename(filePath),
    pdfInfo: {
      pages: images.length,
      ocrCharacters: fullText.length
    },
    statementType,
    custodian,
    accountType,
    maskedAccountRefs: maskedAccounts.length > 0 ? [...new Set(maskedAccounts)] : null,
    ...parsedData
  };
}

// Display results
function displayResults(data) {
  console.log('\n💰 OCR Investment Statement Parser');
  console.log('═'.repeat(60));
  
  console.log(`\nFile: ${data.file}`);
  
  console.log('\n📋 PDF Information:');
  console.log(`   Pages: ${data.pdfInfo.pages}`);
  console.log(`   OCR Characters: ${data.pdfInfo.ocrCharacters.toLocaleString()}`);
  
  console.log('\n🏦 ACCOUNT DETECTION:');
  console.log('─'.repeat(40));
  console.log(`   Statement Type: ${data.statementType}`);
  console.log(`   Custodian: ${data.custodian}`);
  console.log(`   Account Type: ${data.accountType}`);
  if (data.maskedAccountRefs) {
    console.log(`   Account Refs (masked): ${data.maskedAccountRefs.join(', ')}`);
  }
  
  console.log('\n📅 STATEMENT INFO:');
  console.log('─'.repeat(40));
  console.log(`   Statement Date: ${data.statementDate || 'Not found'}`);
  console.log(`   Total Balance: $${data.totalBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  
  if (data.vesting && (data.vesting.percentage || data.vesting.vestedBalance)) {
    console.log('\n🔒 VESTING:');
    console.log('─'.repeat(40));
    if (data.vesting.percentage) {
      console.log(`   Vested: ${data.vesting.percentage}%`);
    }
    if (data.vesting.vestedBalance) {
      console.log(`   Vested Balance: $${data.vesting.vestedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }
  
  if (data.accounts && data.accounts.length > 0) {
    console.log('\n💼 ACCOUNT BREAKDOWN:');
    console.log('─'.repeat(50));
    console.log('   Account Type              Balance        Tax Type');
    console.log('   ' + '─'.repeat(46));
    
    for (const acct of data.accounts) {
      const name = acct.name.substring(0, 22).padEnd(22);
      const balance = `$${acct.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`.padStart(12);
      const taxType = acct.taxType.padStart(12);
      console.log(`   ${name} ${balance} ${taxType}`);
    }
    
    // Summary by tax type
    const byTaxType = {};
    for (const acct of data.accounts) {
      byTaxType[acct.taxType] = (byTaxType[acct.taxType] || 0) + acct.balance;
    }
    
    console.log('\n   📊 By Tax Treatment:');
    for (const [taxType, total] of Object.entries(byTaxType)) {
      console.log(`      ${taxType}: $${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }
  
  if (data.contributions && Object.keys(data.contributions).length > 0) {
    console.log('\n💵 YTD CONTRIBUTIONS:');
    console.log('─'.repeat(40));
    for (const [name, amount] of Object.entries(data.contributions)) {
      console.log(`   ${name}: $${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }
  
  if (data.holdings && data.holdings.length > 0) {
    console.log('\n📊 FUND HOLDINGS:');
    console.log('─'.repeat(50));
    for (const holding of data.holdings) {
      console.log(`   ${holding.name}: $${holding.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    }
  }
  
  // Prepare data for storage
  const storageData = {
    custodian: data.custodian,
    accountType: data.accountType,
    statementType: data.statementType,
    snapshotDate: data.statementDate,
    totalBalance: data.totalBalance,
    accounts: data.accounts || [],
    holdings: data.holdings || [],
    vesting: data.vesting || {},
    contributions: data.contributions || {},
    isProjected: false,
    sourceStatement: data.file
  };
  
  console.log('\n' + '═'.repeat(60));
  console.log('📦 DATA READY FOR STORAGE:');
  console.log('─'.repeat(60));
  console.log(JSON.stringify(storageData, null, 2));
  
  return storageData;
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  npm run ocr-investment -- ./statements/filename.pdf');
    console.log('  npm run ocr-investment -- ./statements/filename.pdf --raw');
    process.exit(1);
  }
  
  try {
    const filePath = args[0];
    const showRaw = args.includes('--raw');
    const data = await parseStatement(filePath, showRaw);
    displayResults(data);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
