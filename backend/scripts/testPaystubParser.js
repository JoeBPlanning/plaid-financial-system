#!/usr/bin/env node
/**
 * Test Paystub Parser
 * 
 * This script tests PDF parsing WITHOUT storing any data.
 * 
 * Usage:
 *   node scripts/testPaystubParser.js <path-to-pdf>
 *   node scripts/testPaystubParser.js ./statements/paystub.pdf --raw
 *   node scripts/testPaystubParser.js ./statements/paystub.pdf --debug
 */

const fs = require('fs');
const path = require('path');
const moment = require('moment');
const pdfParse = require('pdf-parse');

// Command line args
const args = process.argv.slice(2);
const pdfPath = args.find(a => !a.startsWith('--'));
const showRaw = args.includes('--raw');
const debug = args.includes('--debug');

/**
 * Parse currency string to number (handles negatives)
 * Also handles concatenated numbers without decimals
 */
function parseCurrency(str) {
  if (!str) return 0;
  const clean = str.replace(/[,$\s]/g, '');
  // Handle negative with minus or parentheses
  const isNegative = clean.includes('(') || clean.startsWith('-');
  const numStr = clean.replace(/[()-]/g, '');
  
  let value = parseFloat(numStr) || 0;
  
  // If no decimal point and looks like cents are included (common paystub format)
  // Numbers like "46153" should become 461.53, "10801185" should become 108011.85
  if (!str.includes('.') && value > 100) {
    value = value / 100;
  }
  
  return isNegative ? -Math.abs(value) : value;
}

/**
 * Extract a number that might be concatenated (no decimals in source)
 * Assumes 2 decimal places for currency
 */
function extractConcatenatedAmount(numStr) {
  if (!numStr) return 0;
  const clean = numStr.replace(/[^0-9-]/g, '');
  if (!clean) return 0;
  
  const isNegative = clean.startsWith('-');
  const absStr = clean.replace('-', '');
  
  // Insert decimal point 2 places from end
  let value;
  if (absStr.length > 2) {
    value = parseFloat(absStr.slice(0, -2) + '.' + absStr.slice(-2));
  } else {
    value = parseFloat('0.' + absStr.padStart(2, '0'));
  }
  
  return isNegative ? -value : value;
}

/**
 * Determine pay frequency from period dates
 */
function determinePayFrequency(periodStart, periodEnd) {
  if (!periodStart || !periodEnd) return { frequency: 'unknown', periodsPerYear: 24 };
  
  const start = moment(periodStart);
  const end = moment(periodEnd);
  const days = end.diff(start, 'days') + 1;
  
  if (days >= 28 && days <= 31) {
    return { frequency: 'monthly', periodsPerYear: 12 };
  } else if (days >= 14 && days <= 16) {
    return { frequency: 'biweekly', periodsPerYear: 26 };
  } else if (days >= 13 && days <= 17) {
    // Could be semimonthly (15th and end of month)
    return { frequency: 'semimonthly', periodsPerYear: 24 };
  } else if (days >= 6 && days <= 8) {
    return { frequency: 'weekly', periodsPerYear: 52 };
  }
  
  return { frequency: 'biweekly', periodsPerYear: 26 }; // Default
}

/**
 * Calculate remaining pay periods in the year
 */
function calculateRemainingPeriods(periodEnd, periodsPerYear) {
  const endDate = moment(periodEnd);
  const yearEnd = moment(endDate).endOf('year');
  const daysRemaining = yearEnd.diff(endDate, 'days');
  const daysPerPeriod = 365 / periodsPerYear;
  
  return Math.round(daysRemaining / daysPerPeriod);
}

/**
 * Calculate periods elapsed in the year
 */
function calculateElapsedPeriods(periodEnd, periodsPerYear) {
  const endDate = moment(periodEnd);
  const yearStart = moment(endDate).startOf('year');
  const daysElapsed = endDate.diff(yearStart, 'days');
  const daysPerPeriod = 365 / periodsPerYear;
  
  return Math.round(daysElapsed / daysPerPeriod);
}

/**
 * Categorize a deduction as pre-tax or after-tax
 */
function categorizeDeduction(name) {
  const nameLower = name.toLowerCase();
  
  // Pre-tax deductions
  const preTaxPatterns = [
    '401k', '401(k)', '403b', '403(b)', 'hsa', 'fsa', 
    'health', 'medical', 'dental', 'vision',
    'pretax', 'pre-tax', 'prtx',
    'flex', 'cafeteria'
  ];
  
  // After-tax deductions
  const afterTaxPatterns = [
    'roth', 'after-tax', 'aftertax',
    'vol term', 'voluntary life', 'supp life',
    'disability', 'ltd', 'std'
  ];
  
  for (const pattern of afterTaxPatterns) {
    if (nameLower.includes(pattern)) return 'after-tax';
  }
  
  for (const pattern of preTaxPatterns) {
    if (nameLower.includes(pattern)) return 'pre-tax';
  }
  
  // Statutory taxes
  const statutoryPatterns = ['federal', 'state', 'social security', 'medicare', 'fica', 'income tax'];
  for (const pattern of statutoryPatterns) {
    if (nameLower.includes(pattern)) return 'statutory';
  }
  
  return 'other';
}

/**
 * Extract dates from text
 */
function extractDates(text) {
  const dates = {
    periodBeginning: null,
    periodEnding: null,
    payDate: null
  };
  
  // Period ending patterns
  let match = text.match(/period\s*end(?:ing)?[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (match) dates.periodEnding = moment(match[1], ['MM/DD/YYYY', 'MM-DD-YYYY', 'MM/DD/YY']).format('YYYY-MM-DD');
  
  // Period beginning patterns
  match = text.match(/period\s*begin(?:ning)?[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (match) dates.periodBeginning = moment(match[1], ['MM/DD/YYYY', 'MM-DD-YYYY', 'MM/DD/YY']).format('YYYY-MM-DD');
  
  // Pay date patterns
  match = text.match(/pay\s*date[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
  if (match) dates.payDate = moment(match[1], ['MM/DD/YYYY', 'MM-DD-YYYY', 'MM/DD/YY']).format('YYYY-MM-DD');
  
  return dates;
}

/**
 * Extract earnings from text (handles concatenated format)
 */
function extractEarnings(text) {
  const earnings = {
    regular: { current: 0, ytd: 0 },
    overtime: { current: 0, ytd: 0 },
    holiday: { current: 0, ytd: 0 },
    vacation: { current: 0, ytd: 0 },
    sick: { current: 0, ytd: 0 },
    bonus: { current: 0, ytd: 0 },
    commission: { current: 0, ytd: 0 },
    fringe: { current: 0, ytd: 0 },
    other: { current: 0, ytd: 0 },
    gross: { current: 0, ytd: 0 }
  };
  
  // Regular pay - format: Regular[rate][rate][thisPeriod][ytd]
  // Example: Regular46153946153910801185 = 4615.39, 4615.39, 108011.85
  let match = text.match(/Regular(\d{5,8})(\d{5,8})(\d{7,10})/i);
  if (match) {
    // First number is rate, second is this period (same as rate for salary), third is YTD
    earnings.regular.current = extractConcatenatedAmount(match[2]);
    earnings.regular.ytd = extractConcatenatedAmount(match[3]);
  }
  
  // Holiday - format: Holiday[amount] (usually small, 4 digits = 20.00)
  match = text.match(/Holiday(\d{3,6})/i);
  if (match) {
    earnings.holiday.current = extractConcatenatedAmount(match[1]);
  }
  
  // Vacation - format: Vacation[amount]
  match = text.match(/Vacation(\d{3,6})/i);
  if (match) {
    earnings.vacation.current = extractConcatenatedAmount(match[1]);
  }
  
  // Fringe - format: Fringe[ytd] (appears in YTD column)
  match = text.match(/Fringe(\d{4,8})/i);
  if (match) {
    earnings.fringe.ytd = extractConcatenatedAmount(match[1]);
  }
  
  // Gross Pay - format: GrossPay$[thisPeriod] and later [ytd]
  // Looking for pattern like: GrossPay$464039 and 10913685
  match = text.match(/GrossPay\$?(\d{5,8})/i);
  if (match) {
    earnings.gross.current = extractConcatenatedAmount(match[1]);
  }
  
  // YTD gross is usually near the top - look for pattern after period ending
  // The raw shows: 10913685 which is 109136.85
  match = text.match(/\$(\d{6,10})\s*(?:Filing|Excluded)/i);
  if (match) {
    earnings.gross.ytd = extractConcatenatedAmount(match[1]);
  } else {
    // Alternative: look for the large number after pay date area
    match = text.match(/PayDate[:\s\d\/]+[\s\S]*?(\d{8,10})(?=\s*Filing|Excluded)/i);
    if (match) {
      earnings.gross.ytd = extractConcatenatedAmount(match[1]);
    }
  }
  
  return earnings;
}

/**
 * Extract deductions from text (handles concatenated format)
 */
function extractDeductions(text) {
  const deductions = {
    statutory: {
      federal: { current: 0, ytd: 0 },
      socialSecurity: { current: 0, ytd: 0 },
      medicare: { current: 0, ytd: 0 },
      state: { current: 0, ytd: 0 },
      local: { current: 0, ytd: 0 }
    },
    preTax: {},
    afterTax: {},
    other: {}
  };
  
  // Federal Income Tax - format: FederalIncomeTax-[current][ytd]
  // Example: -571221270304 = -571.22, 12703.04
  let match = text.match(/Federal(?:Income)?Tax-?(\d{4,6})(\d{6,9})/i);
  if (match) {
    deductions.statutory.federal.current = extractConcatenatedAmount(match[1]);
    deductions.statutory.federal.ytd = extractConcatenatedAmount(match[2]);
  }
  
  // Social Security Tax - format: SocialSecurityTax-[current][ytd]
  // Example: -27573647543 = -275.73, 6475.43
  match = text.match(/SocialSecurityTax-?(\d{4,6})(\d{5,8})/i);
  if (match) {
    deductions.statutory.socialSecurity.current = extractConcatenatedAmount(match[1]);
    deductions.statutory.socialSecurity.ytd = extractConcatenatedAmount(match[2]);
  }
  
  // Medicare Tax - format: MedicareTax-[current][ytd]
  // Example: -6448151441 = -64.48, 1514.41
  match = text.match(/MedicareTax-?(\d{3,5})(\d{5,8})/i);
  if (match) {
    deductions.statutory.medicare.current = extractConcatenatedAmount(match[1]);
    deductions.statutory.medicare.ytd = extractConcatenatedAmount(match[2]);
  }
  
  // State Income Tax (MD, VA, etc.) - format: MDStateIncomeTax-[current][ytd]
  // Example: -31753739075 = -317.53, 7390.75
  match = text.match(/(?:MD|VA|CA|NY)StateIncomeTax-?(\d{4,6})(\d{5,8})/i);
  if (match) {
    deductions.statutory.state.current = extractConcatenatedAmount(match[1]);
    deductions.statutory.state.ytd = extractConcatenatedAmount(match[2]);
  }
  
  // 401K (pre-tax) - format: 401K-[current]*[ytd]
  // Example: -23077*620364 = -230.77, 6203.64
  match = text.match(/401K-?(\d{4,6})\*?(\d{5,8})/i);
  if (match) {
    deductions.preTax['401k'] = {
      current: extractConcatenatedAmount(match[1]),
      ytd: extractConcatenatedAmount(match[2])
    };
  }
  
  // Roth (after-tax) - format: Roth$-[current][ytd]
  // Example: -46154253847 = -461.54, 2538.47
  match = text.match(/Roth\$?-?(\d{4,6})(\d{5,8})/i);
  if (match) {
    deductions.afterTax['roth'] = {
      current: extractConcatenatedAmount(match[1]),
      ytd: extractConcatenatedAmount(match[2])
    };
  }
  
  // FSA (pre-tax) - format: PrtxFsa-[current]*[ytd]
  // Example: -10000*250000 = -100.00, 2500.00
  match = text.match(/PrtxFsa-?(\d{4,6})\*?(\d{5,8})/i);
  if (match) {
    deductions.preTax['fsa_health'] = {
      current: extractConcatenatedAmount(match[1]),
      ytd: extractConcatenatedAmount(match[2])
    };
  }
  
  // Medical (pre-tax) - format: PrtxMed-[current]*[ytd]
  // Example: -7000*161000 = -70.00, 1610.00
  match = text.match(/PrtxMed-?(\d{3,6})\*?(\d{5,8})/i);
  if (match) {
    deductions.preTax['health_insurance'] = {
      current: extractConcatenatedAmount(match[1]),
      ytd: extractConcatenatedAmount(match[2])
    };
  }
  
  // Dental - format: Dental-[current]*[ytd]
  // Example: -550*12650 = -5.50, 126.50
  match = text.match(/Dental-?(\d{2,5})\*?(\d{4,7})/i);
  if (match) {
    deductions.preTax['dental'] = {
      current: extractConcatenatedAmount(match[1]),
      ytd: extractConcatenatedAmount(match[2])
    };
  }
  
  // Vision - format: Vision-[current]*[ytd]
  // Example: -150*3450 = -1.50, 34.50
  match = text.match(/Vision-?(\d{2,4})\*?(\d{3,6})/i);
  if (match) {
    deductions.preTax['vision'] = {
      current: extractConcatenatedAmount(match[1]),
      ytd: extractConcatenatedAmount(match[2])
    };
  }
  
  // Vol Term Life (after-tax) - format: VolTermLife-[current][ytd]
  // Example: -90020700 = -9.00, 207.00
  match = text.match(/VolTermLife-?(\d{2,5})(\d{4,7})/i);
  if (match) {
    deductions.afterTax['life_insurance'] = {
      current: extractConcatenatedAmount(match[1]),
      ytd: extractConcatenatedAmount(match[2])
    };
  }
  
  return deductions;
}

/**
 * Extract employer contributions (handles concatenated format)
 */
function extractEmployerContributions(text) {
  const contributions = {
    match401k: { current: 0, ytd: 0 }
  };
  
  // Er Contribution (employer 401k match) - format: ErContribution[current][ytd]
  // Example: 461541080117 = 461.54, 10801.17
  let match = text.match(/ErContribution(\d{4,6})(\d{6,9})/i);
  if (match) {
    contributions.match401k.current = extractConcatenatedAmount(match[1]);
    contributions.match401k.ytd = extractConcatenatedAmount(match[2]);
  }
  
  return contributions;
}

/**
 * Extract net pay (handles concatenated format)
 */
function extractNetPay(text) {
  // NetPay$[amount] - Example: NetPay$250787 = 2507.87
  let match = text.match(/NetPay\$?(\d{5,8})/i);
  if (match) return extractConcatenatedAmount(match[1]);
  return 0;
}

/**
 * Main parsing function
 */
async function parsePaystub(filePath) {
  console.log('\n💰 Paystub Parser (TEST MODE)');
  console.log('═'.repeat(60));
  console.log(`\nFile: ${filePath}\n`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }
  
  const dataBuffer = fs.readFileSync(filePath);
  let pdfData;
  
  try {
    pdfData = await pdfParse(dataBuffer);
  } catch (error) {
    console.error('❌ Error parsing PDF:', error.message);
    process.exit(1);
  }
  
  const text = pdfData.text;
  
  if (showRaw) {
    console.log('📝 RAW EXTRACTED TEXT:');
    console.log('─'.repeat(60));
    console.log(text);
    console.log('─'.repeat(60));
    console.log('\n');
  }
  
  console.log('📋 PDF Information:');
  console.log(`   Pages: ${pdfData.numpages}`);
  console.log(`   Characters: ${text.length.toLocaleString()}`);
  
  // Extract dates
  const dates = extractDates(text);
  const { frequency, periodsPerYear } = determinePayFrequency(dates.periodBeginning, dates.periodEnding);
  
  console.log('\n📅 PAY PERIOD:');
  console.log('─'.repeat(40));
  console.log(`   Period Beginning: ${dates.periodBeginning || 'Not found'}`);
  console.log(`   Period Ending: ${dates.periodEnding || 'Not found'}`);
  console.log(`   Pay Date: ${dates.payDate || 'Not found'}`);
  console.log(`   Frequency: ${frequency} (${periodsPerYear} periods/year)`);
  
  if (dates.periodEnding) {
    const remaining = calculateRemainingPeriods(dates.periodEnding, periodsPerYear);
    const elapsed = calculateElapsedPeriods(dates.periodEnding, periodsPerYear);
    console.log(`   Periods Elapsed: ${elapsed}`);
    console.log(`   Periods Remaining: ${remaining}`);
  }
  
  // Extract earnings
  const earnings = extractEarnings(text);
  
  console.log('\n💵 EARNINGS:');
  console.log('─'.repeat(50));
  console.log('   Category'.padEnd(20) + 'This Period'.padEnd(15) + 'Year to Date');
  console.log('   ' + '─'.repeat(45));
  
  if (earnings.regular.current || earnings.regular.ytd)
    console.log(`   ${'Regular'.padEnd(17)} $${earnings.regular.current.toLocaleString().padEnd(12)} $${earnings.regular.ytd.toLocaleString()}`);
  if (earnings.holiday.current)
    console.log(`   ${'Holiday'.padEnd(17)} $${earnings.holiday.current.toLocaleString().padEnd(12)} -`);
  if (earnings.vacation.current)
    console.log(`   ${'Vacation'.padEnd(17)} $${earnings.vacation.current.toLocaleString().padEnd(12)} -`);
  if (earnings.fringe.current || earnings.fringe.ytd)
    console.log(`   ${'Fringe'.padEnd(17)} $${earnings.fringe.current.toLocaleString().padEnd(12)} $${earnings.fringe.ytd.toLocaleString()}`);
  
  console.log('   ' + '─'.repeat(45));
  console.log(`   ${'GROSS PAY'.padEnd(17)} $${earnings.gross.current.toLocaleString().padEnd(12)} $${earnings.gross.ytd.toLocaleString()}`);
  
  // Extract deductions
  const deductions = extractDeductions(text);
  
  console.log('\n📋 STATUTORY DEDUCTIONS:');
  console.log('─'.repeat(50));
  console.log('   Category'.padEnd(25) + 'This Period'.padEnd(15) + 'Year to Date');
  console.log('   ' + '─'.repeat(45));
  
  if (deductions.statutory.federal.current)
    console.log(`   ${'Federal Income Tax'.padEnd(22)} $${deductions.statutory.federal.current.toLocaleString().padEnd(12)} $${deductions.statutory.federal.ytd.toLocaleString()}`);
  if (deductions.statutory.socialSecurity.current)
    console.log(`   ${'Social Security'.padEnd(22)} $${deductions.statutory.socialSecurity.current.toLocaleString().padEnd(12)} $${deductions.statutory.socialSecurity.ytd.toLocaleString()}`);
  if (deductions.statutory.medicare.current)
    console.log(`   ${'Medicare'.padEnd(22)} $${deductions.statutory.medicare.current.toLocaleString().padEnd(12)} $${deductions.statutory.medicare.ytd.toLocaleString()}`);
  if (deductions.statutory.state.current)
    console.log(`   ${'State Income Tax'.padEnd(22)} $${deductions.statutory.state.current.toLocaleString().padEnd(12)} $${deductions.statutory.state.ytd.toLocaleString()}`);
  
  console.log('\n💼 PRE-TAX DEDUCTIONS:');
  console.log('─'.repeat(50));
  Object.entries(deductions.preTax).forEach(([name, vals]) => {
    console.log(`   ${name.padEnd(22)} $${vals.current.toLocaleString().padEnd(12)} $${vals.ytd.toLocaleString()}`);
  });
  
  console.log('\n💳 AFTER-TAX DEDUCTIONS:');
  console.log('─'.repeat(50));
  Object.entries(deductions.afterTax).forEach(([name, vals]) => {
    console.log(`   ${name.padEnd(22)} $${vals.current.toLocaleString().padEnd(12)} $${vals.ytd.toLocaleString()}`);
  });
  
  // Employer contributions
  const employer = extractEmployerContributions(text);
  
  console.log('\n🏢 EMPLOYER CONTRIBUTIONS:');
  console.log('─'.repeat(50));
  if (employer.match401k.current || employer.match401k.ytd)
    console.log(`   ${'401k Match'.padEnd(22)} $${employer.match401k.current.toLocaleString().padEnd(12)} $${employer.match401k.ytd.toLocaleString()}`);
  
  // Net pay
  const netPay = extractNetPay(text);
  console.log('\n💰 NET PAY: $' + netPay.toLocaleString());
  
  // Projections
  if (dates.periodEnding) {
    const remaining = calculateRemainingPeriods(dates.periodEnding, periodsPerYear);
    
    console.log('\n📊 ANNUAL PROJECTIONS:');
    console.log('─'.repeat(50));
    
    // Estimated annual gross = YTD + (remaining periods * current period)
    const estimatedAnnualGross = earnings.gross.ytd + (remaining * earnings.gross.current);
    console.log(`   Estimated Annual Gross: $${estimatedAnnualGross.toLocaleString()}`);
    
    const estimatedFederalTax = deductions.statutory.federal.ytd + (remaining * deductions.statutory.federal.current);
    console.log(`   Estimated Federal Tax: $${estimatedFederalTax.toLocaleString()}`);
    
    const estimatedStateTax = deductions.statutory.state.ytd + (remaining * deductions.statutory.state.current);
    console.log(`   Estimated State Tax: $${estimatedStateTax.toLocaleString()}`);
    
    const estimatedFICA = deductions.statutory.socialSecurity.ytd + deductions.statutory.medicare.ytd +
                          (remaining * (deductions.statutory.socialSecurity.current + deductions.statutory.medicare.current));
    console.log(`   Estimated FICA: $${estimatedFICA.toLocaleString()}`);
    
    // Pre-tax deductions total
    let preTaxTotal = 0;
    Object.values(deductions.preTax).forEach(v => preTaxTotal += v.ytd);
    Object.values(deductions.preTax).forEach(v => preTaxTotal += remaining * v.current);
    console.log(`   Estimated Pre-Tax Deductions: $${preTaxTotal.toLocaleString()}`);
    
    // Effective tax rate
    const totalTax = estimatedFederalTax + estimatedStateTax + estimatedFICA;
    const effectiveRate = ((totalTax / estimatedAnnualGross) * 100).toFixed(1);
    console.log(`   Effective Tax Rate: ${effectiveRate}%`);
  }
  
  // Summary for storage
  console.log('\n' + '═'.repeat(60));
  console.log('📦 DATA READY FOR STORAGE:');
  console.log('─'.repeat(60));
  
  const storageData = {
    dates,
    payFrequency: frequency,
    periodsPerYear,
    earnings,
    deductions,
    employerContributions: employer,
    netPay
  };
  
  console.log(JSON.stringify(storageData, null, 2));
  
  if (debug) {
    console.log('\n🔍 DEBUG - All Dollar Amounts:');
    console.log('─'.repeat(60));
    const amounts = [];
    const pattern = /\$?([\d,]+\.?\d*)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const amount = parseCurrency(match[1]);
      if (amount >= 1 && amount < 1000000) {
        const start = Math.max(0, match.index - 25);
        const end = Math.min(text.length, match.index + match[0].length + 25);
        const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
        amounts.push({ amount, context });
      }
    }
    amounts.slice(0, 40).forEach(a => {
      console.log(`   $${a.amount.toLocaleString().padEnd(12)} | ...${a.context}...`);
    });
  }
  
  console.log('\n');
}

// Main
if (!pdfPath) {
  console.log(`
💰 Paystub Parser (TEST MODE)

Usage:
  node scripts/testPaystubParser.js <path-to-pdf> [options]

Options:
  --raw     Show raw extracted text from PDF
  --debug   Show all dollar amounts found with context

Examples:
  node scripts/testPaystubParser.js ./statements/paystub.pdf
  node scripts/testPaystubParser.js ./statements/paystub.pdf --raw
`);
  process.exit(0);
}

parsePaystub(pdfPath).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
