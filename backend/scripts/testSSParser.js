#!/usr/bin/env node
/**
 * Test Social Security Statement Parser
 * 
 * This script tests PDF parsing WITHOUT storing any data.
 * Use it to experiment and perfect the extraction before committing.
 * 
 * Usage:
 *   node scripts/testSSParser.js <path-to-pdf>
 *   node scripts/testSSParser.js ./statements/my_ss_statement.pdf
 *   
 * Options:
 *   --raw          Show raw extracted text
 *   --debug        Show detailed parsing info
 */

const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

// Command line args
const args = process.argv.slice(2);
const pdfPath = args.find(a => !a.startsWith('--'));
const showRaw = args.includes('--raw');
const debug = args.includes('--debug');

// Patterns to extract from SS statement
const PATTERNS = {
  // Benefits at different ages
  benefit62: /at age 62[:\s]+\$?([\d,]+)/i,
  benefit67: /at (?:age )?(?:full retirement age|67)[:\s]+\$?([\d,]+)/i,
  benefit70: /at age 70[:\s]+\$?([\d,]+)/i,
  
  // Alternative benefit patterns
  benefitAlt62: /62[:\s]+\$?([\d,]+)\s*(?:a month|per month|monthly)/i,
  benefitAlt67: /67[:\s]+\$?([\d,]+)\s*(?:a month|per month|monthly)/i,
  benefitAlt70: /70[:\s]+\$?([\d,]+)\s*(?:a month|per month|monthly)/i,
  
  // Retirement benefits section
  retirementSection: /Your Estimated Benefits[\s\S]*?Retirement/i,
  
  // Disability benefit
  disability: /disability[:\s]+\$?([\d,]+)/i,
  disabilityAlt: /if you became disabled[:\s\S]*?\$?([\d,]+)/i,
  
  // Survivor benefits
  survivor: /survivors?[:\s]+\$?([\d,]+)/i,
  survivorChild: /child[:\s]+\$?([\d,]+)/i,
  survivorSpouse: /spouse[:\s]+\$?([\d,]+)/i,
  
  // Earnings history - matches year and amounts
  earningsRow: /(\d{4})\s+\$?([\d,]+)\s+\$?([\d,]+)/g,
  
  // Medicare
  medicareCredits: /(\d+)\s*(?:credits?|quarters?)/i,
  medicareEligible: /eligible for Medicare/i,
  
  // Personal info
  birthDate: /(?:birth|born|DOB)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ssn: /(\d{3}[-\s]?\d{2}[-\s]?\d{4})/,
  
  // Totals
  totalEarnings: /total earnings[:\s]+\$?([\d,]+)/i,
  totalSSPaid: /(?:you paid|your taxes)[:\s]+\$?([\d,]+)/i,
};

/**
 * Parse currency string to number
 */
function parseCurrency(str) {
  if (!str) return null;
  return parseFloat(str.replace(/[,$]/g, ''));
}

/**
 * Extract benefits from text
 */
function extractBenefits(text) {
  const benefits = {};
  
  // Try primary patterns first
  let match = text.match(PATTERNS.benefit62) || text.match(PATTERNS.benefitAlt62);
  if (match) benefits.age62 = parseCurrency(match[1]);
  
  match = text.match(PATTERNS.benefit67) || text.match(PATTERNS.benefitAlt67);
  if (match) benefits.age67 = parseCurrency(match[1]);
  
  match = text.match(PATTERNS.benefit70) || text.match(PATTERNS.benefitAlt70);
  if (match) benefits.age70 = parseCurrency(match[1]);
  
  // Try to find benefits in a table format
  // Look for patterns like: "62  $1,234" or "Age 62: $1,234"
  const agePattern = /(?:age\s*)?(\d{2})\s*[:\s]+\$?([\d,]+)(?:\s*(?:a month|monthly|per month))?/gi;
  let ageMatch;
  while ((ageMatch = agePattern.exec(text)) !== null) {
    const age = parseInt(ageMatch[1]);
    const amount = parseCurrency(ageMatch[2]);
    if (age >= 62 && age <= 70 && amount > 100 && amount < 10000) {
      benefits[`age${age}`] = benefits[`age${age}`] || amount;
    }
  }
  
  return benefits;
}

/**
 * Extract disability and survivor benefits
 */
function extractOtherBenefits(text) {
  const other = {};
  
  let match = text.match(PATTERNS.disability) || text.match(PATTERNS.disabilityAlt);
  if (match) other.disability = parseCurrency(match[1]);
  
  match = text.match(PATTERNS.survivor);
  if (match) other.survivor = parseCurrency(match[1]);
  
  match = text.match(PATTERNS.survivorSpouse);
  if (match) other.survivorSpouse = parseCurrency(match[1]);
  
  match = text.match(PATTERNS.survivorChild);
  if (match) other.survivorChild = parseCurrency(match[1]);
  
  return other;
}

/**
 * Extract earnings history
 */
function extractEarnings(text) {
  const earnings = [];
  
  // Look for earnings table section
  const earningsSection = text.match(/Your Taxed Social Security Earnings[\s\S]*?Your Taxed Medicare Earnings/i) ||
                          text.match(/Earnings Record[\s\S]*?(?=Your Estimated|$)/i);
  
  const searchText = earningsSection ? earningsSection[0] : text;
  
  // Pattern: Year, SS Earnings, Medicare Earnings
  const rowPattern = /(\d{4})\s+\$?([\d,]+)\s+\$?([\d,]+)/g;
  let match;
  
  while ((match = rowPattern.exec(searchText)) !== null) {
    const year = parseInt(match[1]);
    // Filter reasonable years (1950-2030)
    if (year >= 1950 && year <= 2030) {
      earnings.push({
        year,
        ssEarnings: parseCurrency(match[2]),
        medicareEarnings: parseCurrency(match[3])
      });
    }
  }
  
  // Sort by year descending
  earnings.sort((a, b) => b.year - a.year);
  
  return earnings;
}

/**
 * Extract Medicare info
 */
function extractMedicare(text) {
  const medicare = {
    credits: null,
    eligible: false
  };
  
  const creditsMatch = text.match(PATTERNS.medicareCredits);
  if (creditsMatch) {
    medicare.credits = parseInt(creditsMatch[1]);
  }
  
  medicare.eligible = PATTERNS.medicareEligible.test(text);
  
  return medicare;
}

/**
 * Find all dollar amounts in text for debugging
 */
function findAllAmounts(text) {
  const amounts = [];
  const pattern = /\$?([\d,]+(?:\.\d{2})?)/g;
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const amount = parseCurrency(match[1]);
    if (amount >= 100 && amount < 1000000) {
      // Get surrounding context
      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      const context = text.substring(start, end).replace(/\s+/g, ' ').trim();
      
      amounts.push({ amount, context });
    }
  }
  
  return amounts;
}

/**
 * Main parsing function
 */
async function parseSSStatement(filePath) {
  console.log('\n📄 Social Security Statement Parser (TEST MODE)');
  console.log('═'.repeat(60));
  console.log(`\nFile: ${filePath}\n`);
  
  // Check file exists
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }
  
  // Read and parse PDF
  const dataBuffer = fs.readFileSync(filePath);
  
  let pdfData;
  try {
    pdfData = await pdf(dataBuffer);
  } catch (error) {
    console.error('❌ Error parsing PDF:', error.message);
    console.log('\n💡 If this is a scanned document, it may need OCR processing.');
    process.exit(1);
  }
  
  const text = pdfData.text;
  
  // Show raw text if requested
  if (showRaw) {
    console.log('📝 RAW EXTRACTED TEXT:');
    console.log('─'.repeat(60));
    console.log(text);
    console.log('─'.repeat(60));
    console.log('\n');
  }
  
  // PDF metadata
  console.log('📋 PDF Information:');
  console.log(`   Pages: ${pdfData.numpages}`);
  console.log(`   Characters: ${text.length.toLocaleString()}`);
  
  // Extract data
  console.log('\n💰 RETIREMENT BENEFITS:');
  console.log('─'.repeat(40));
  const benefits = extractBenefits(text);
  if (Object.keys(benefits).length > 0) {
    Object.entries(benefits).forEach(([age, amount]) => {
      const ageNum = age.replace('age', '');
      const marker = ageNum === '67' ? ' (Full Retirement Age)' : '';
      console.log(`   Age ${ageNum}${marker}: $${amount.toLocaleString()}/month`);
    });
  } else {
    console.log('   ⚠️  No benefits found - may need pattern adjustment');
  }
  
  console.log('\n🛡️  OTHER BENEFITS:');
  console.log('─'.repeat(40));
  const otherBenefits = extractOtherBenefits(text);
  if (Object.keys(otherBenefits).length > 0) {
    if (otherBenefits.disability) console.log(`   Disability: $${otherBenefits.disability.toLocaleString()}/month`);
    if (otherBenefits.survivor) console.log(`   Survivor: $${otherBenefits.survivor.toLocaleString()}/month`);
    if (otherBenefits.survivorSpouse) console.log(`   Survivor (Spouse): $${otherBenefits.survivorSpouse.toLocaleString()}/month`);
    if (otherBenefits.survivorChild) console.log(`   Survivor (Child): $${otherBenefits.survivorChild.toLocaleString()}/month`);
  } else {
    console.log('   ⚠️  No other benefits found');
  }
  
  console.log('\n🏥 MEDICARE:');
  console.log('─'.repeat(40));
  const medicare = extractMedicare(text);
  console.log(`   Credits: ${medicare.credits || 'Not found'}`);
  console.log(`   Eligible: ${medicare.eligible ? 'Yes' : 'Not found/No'}`);
  
  console.log('\n📈 EARNINGS HISTORY:');
  console.log('─'.repeat(40));
  const earnings = extractEarnings(text);
  if (earnings.length > 0) {
    console.log('   Year     SS Earnings    Medicare Earnings');
    console.log('   ' + '─'.repeat(45));
    earnings.slice(0, 15).forEach(e => {
      console.log(`   ${e.year}     $${e.ssEarnings.toLocaleString().padEnd(12)} $${e.medicareEarnings.toLocaleString()}`);
    });
    if (earnings.length > 15) {
      console.log(`   ... and ${earnings.length - 15} more years`);
    }
    
    // Calculate totals
    const totalSS = earnings.reduce((sum, e) => sum + e.ssEarnings, 0);
    const totalMedicare = earnings.reduce((sum, e) => sum + e.medicareEarnings, 0);
    console.log('   ' + '─'.repeat(45));
    console.log(`   Total:   $${totalSS.toLocaleString().padEnd(12)} $${totalMedicare.toLocaleString()}`);
  } else {
    console.log('   ⚠️  No earnings history found');
  }
  
  // Debug mode - show all found amounts
  if (debug) {
    console.log('\n🔍 DEBUG - All Dollar Amounts Found:');
    console.log('─'.repeat(60));
    const amounts = findAllAmounts(text);
    amounts.slice(0, 30).forEach(a => {
      console.log(`   $${a.amount.toLocaleString().padEnd(12)} | ...${a.context}...`);
    });
    if (amounts.length > 30) {
      console.log(`   ... and ${amounts.length - 30} more amounts`);
    }
  }
  
  // Summary for storage
  console.log('\n' + '═'.repeat(60));
  console.log('📦 DATA READY FOR STORAGE:');
  console.log('─'.repeat(60));
  
  const storageData = {
    benefits: benefits,
    disability: otherBenefits.disability,
    survivor: otherBenefits.survivor || otherBenefits.survivorSpouse,
    medicare: medicare,
    earningsYears: earnings.length,
    totalSSEarnings: earnings.reduce((sum, e) => sum + e.ssEarnings, 0),
  };
  
  console.log(JSON.stringify(storageData, null, 2));
  
  console.log('\n💡 To improve extraction:');
  console.log('   - Use --raw to see the full extracted text');
  console.log('   - Use --debug to see all dollar amounts with context');
  console.log('   - Adjust patterns in this script based on your statement format\n');
  
  return { benefits, otherBenefits, medicare, earnings };
}

// Main
if (!pdfPath) {
  console.log(`
📄 Social Security Statement Parser (TEST MODE)

Usage:
  node scripts/testSSParser.js <path-to-pdf> [options]

Options:
  --raw     Show raw extracted text from PDF
  --debug   Show all dollar amounts found with context

Examples:
  node scripts/testSSParser.js ./statements/my_statement.pdf
  node scripts/testSSParser.js ./statements/my_statement.pdf --raw
  node scripts/testSSParser.js ./statements/my_statement.pdf --debug

Place your SS statement PDF in the backend/statements/ folder.
`);
  process.exit(0);
}

parseSSStatement(pdfPath).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
