#!/usr/bin/env node
/**
 * Social Security Manager CLI
 * 
 * Usage:
 *   node scripts/socialSecurityManager.js --client <clientId> --action <action> [options]
 * 
 * Actions:
 *   list-clients          List all clients
 *   view                  View SS data for a client
 *   add-manual            Add SS data manually (requires --birthdate, --income)
 *   add-earnings          Add earnings for a year (requires --year, --earnings)
 *   import                Parse SS statement PDF and import to DB (requires --file)
 *   add-benefits          Manually add benefit amounts
 *   
 * Options:
 *   --client <id>         Client ID (UUID) or email
 *   --birthdate <date>    Birth date (YYYY-MM-DD)
 *   --income <amount>     Current/average annual income
 *   --year <year>         Work year for earnings
 *   --earnings <amount>   Earnings for the year
 *   --file <path>         Path to SS statement PDF
 *   --benefit-62 <amt>    Manually set benefit at 62
 *   --benefit-67 <amt>    Manually set benefit at 67 (FRA)
 *   --benefit-70 <amt>    Manually set benefit at 70
 * 
 * Examples:
 *   node scripts/socialSecurityManager.js --action list-clients
 *   node scripts/socialSecurityManager.js --client joe@example.com --action view
 *   node scripts/socialSecurityManager.js --client <id> --action add-manual --birthdate 1970-05-15 --income 100000
 *   node scripts/socialSecurityManager.js --client <id> --action add-earnings --year 2023 --earnings 150000
 *   node scripts/socialSecurityManager.js --client <id> --action parse-statement --file ./statements/ss_statement.pdf
 */

require('dotenv').config({ path: '.env.development' });

const fs = require('fs');
const path = require('path');
const moment = require('moment');
const pdfParse = require('pdf-parse');
const { initDatabase, getDatabase } = require('../database-supabase');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

const CONFIG = {
  clientId: getArg('client'),
  action: getArg('action') || 'view',
  birthdate: getArg('birthdate'),
  income: parseFloat(getArg('income')) || 0,
  year: parseInt(getArg('year')) || new Date().getFullYear(),
  earnings: parseFloat(getArg('earnings')) || 0,
  file: getArg('file'),
  benefit62: parseFloat(getArg('benefit-62')) || null,
  benefit67: parseFloat(getArg('benefit-67')) || null,
  benefit70: parseFloat(getArg('benefit-70')) || null,
};

// Social Security constants for 2024
const SS_CONSTANTS = {
  // Tax rates
  SS_TAX_RATE: 0.062,           // 6.2% employee, 6.2% employer
  MEDICARE_TAX_RATE: 0.0145,    // 1.45% employee, 1.45% employer
  
  // Wage base limits (2024)
  SS_WAGE_BASE: 168600,         // Maximum earnings subject to SS tax
  
  // Credits
  CREDIT_AMOUNT: 1730,          // Earnings needed per credit in 2024
  MAX_CREDITS_PER_YEAR: 4,
  CREDITS_FOR_MEDICARE: 40,     // 10 years of work
  
  // Bend points for PIA calculation (2024)
  BEND_POINT_1: 1174,
  BEND_POINT_2: 7078,
  
  // Early/delayed retirement factors
  EARLY_REDUCTION_PER_MONTH: 0.00556,  // 5/9 of 1% for first 36 months
  EARLY_REDUCTION_AFTER_36: 0.00417,   // 5/12 of 1% after 36 months
  DELAYED_CREDIT_PER_MONTH: 0.00667,   // 2/3 of 1% (8% per year)
};

/**
 * Get Full Retirement Age based on birth year
 */
function getFullRetirementAge(birthYear) {
  if (birthYear <= 1937) return { years: 65, months: 0 };
  if (birthYear === 1938) return { years: 65, months: 2 };
  if (birthYear === 1939) return { years: 65, months: 4 };
  if (birthYear === 1940) return { years: 65, months: 6 };
  if (birthYear === 1941) return { years: 65, months: 8 };
  if (birthYear === 1942) return { years: 65, months: 10 };
  if (birthYear >= 1943 && birthYear <= 1954) return { years: 66, months: 0 };
  if (birthYear === 1955) return { years: 66, months: 2 };
  if (birthYear === 1956) return { years: 66, months: 4 };
  if (birthYear === 1957) return { years: 66, months: 6 };
  if (birthYear === 1958) return { years: 66, months: 8 };
  if (birthYear === 1959) return { years: 66, months: 10 };
  return { years: 67, months: 0 }; // 1960 and later
}

/**
 * Calculate Average Indexed Monthly Earnings (AIME)
 * Uses top 35 years of earnings
 */
function calculateAIME(earningsHistory) {
  // Sort earnings and take top 35 years
  const sortedEarnings = earningsHistory
    .map(e => e.taxed_social_security_earnings || 0)
    .sort((a, b) => b - a)
    .slice(0, 35);
  
  // Pad with zeros if less than 35 years
  while (sortedEarnings.length < 35) {
    sortedEarnings.push(0);
  }
  
  const totalEarnings = sortedEarnings.reduce((sum, e) => sum + e, 0);
  const aime = totalEarnings / (35 * 12); // Average monthly over 35 years
  
  return Math.floor(aime);
}

/**
 * Calculate Primary Insurance Amount (PIA) from AIME
 */
function calculatePIA(aime) {
  let pia = 0;
  
  // First bend point: 90% of first $1,174
  if (aime <= SS_CONSTANTS.BEND_POINT_1) {
    pia = aime * 0.90;
  } else if (aime <= SS_CONSTANTS.BEND_POINT_2) {
    // 90% of first bend point + 32% of amount between bend points
    pia = (SS_CONSTANTS.BEND_POINT_1 * 0.90) + 
          ((aime - SS_CONSTANTS.BEND_POINT_1) * 0.32);
  } else {
    // 90% + 32% + 15% of amount over second bend point
    pia = (SS_CONSTANTS.BEND_POINT_1 * 0.90) + 
          ((SS_CONSTANTS.BEND_POINT_2 - SS_CONSTANTS.BEND_POINT_1) * 0.32) +
          ((aime - SS_CONSTANTS.BEND_POINT_2) * 0.15);
  }
  
  return Math.floor(pia * 100) / 100;
}

/**
 * Calculate benefit at different ages based on PIA and FRA
 */
function calculateBenefitAtAge(pia, fraMonths, claimAgeMonths) {
  const monthsDiff = claimAgeMonths - fraMonths;
  
  if (monthsDiff === 0) {
    return pia;
  } else if (monthsDiff < 0) {
    // Early retirement reduction
    const monthsEarly = Math.abs(monthsDiff);
    let reduction = 0;
    
    if (monthsEarly <= 36) {
      reduction = monthsEarly * SS_CONSTANTS.EARLY_REDUCTION_PER_MONTH;
    } else {
      reduction = (36 * SS_CONSTANTS.EARLY_REDUCTION_PER_MONTH) + 
                  ((monthsEarly - 36) * SS_CONSTANTS.EARLY_REDUCTION_AFTER_36);
    }
    
    return Math.floor(pia * (1 - reduction) * 100) / 100;
  } else {
    // Delayed retirement credits (up to age 70)
    const monthsDelayed = Math.min(monthsDiff, (70 * 12) - fraMonths);
    const increase = monthsDelayed * SS_CONSTANTS.DELAYED_CREDIT_PER_MONTH;
    
    return Math.floor(pia * (1 + increase) * 100) / 100;
  }
}

/**
 * Estimate PIA from current income (simplified projection)
 */
function estimatePIAFromIncome(annualIncome, currentAge, workYears = 35) {
  // Cap at SS wage base
  const cappedIncome = Math.min(annualIncome, SS_CONSTANTS.SS_WAGE_BASE);
  
  // Assume similar earnings for career (simplified)
  const estimatedAIME = (cappedIncome * workYears) / (35 * 12);
  
  return calculatePIA(estimatedAIME);
}

/**
 * Calculate credits earned from earnings
 */
function calculateCredits(earnings) {
  const credits = Math.min(
    Math.floor(earnings / SS_CONSTANTS.CREDIT_AMOUNT),
    SS_CONSTANTS.MAX_CREDITS_PER_YEAR
  );
  return credits;
}

/**
 * List all clients
 */
async function listClients() {
  const supabase = getDatabase();
  
  const { data, error } = await supabase
    .from('clients')
    .select('client_id, name, email')
    .order('name');
  
  if (error) {
    console.error('Error fetching clients:', error);
    return;
  }
  
  console.log('\n📋 All Clients:');
  console.log('─'.repeat(80));
  console.log('ID'.padEnd(40) + 'Name'.padEnd(25) + 'Email');
  console.log('─'.repeat(80));
  
  data.forEach(c => {
    console.log(`${c.client_id.padEnd(40)}${(c.name || 'N/A').padEnd(25)}${c.email || 'N/A'}`);
  });
  
  console.log('─'.repeat(80));
  console.log(`Total: ${data.length} clients\n`);
}

/**
 * Find client by ID or email
 */
async function findClient(identifier) {
  const supabase = getDatabase();
  
  // Try UUID first
  let { data, error } = await supabase
    .from('clients')
    .select('client_id, name, email')
    .eq('client_id', identifier)
    .single();
  
  if (error || !data) {
    // Try email
    const result = await supabase
      .from('clients')
      .select('client_id, name, email')
      .eq('email', identifier)
      .single();
    
    data = result.data;
    error = result.error;
  }
  
  if (error || !data) {
    console.error(`❌ Client not found: ${identifier}`);
    return null;
  }
  
  return data;
}

/**
 * View SS data for a client
 */
async function viewSSData(clientId) {
  const supabase = getDatabase();
  
  // Get SS data
  const { data: ssData, error: ssError } = await supabase
    .from('social_security')
    .select('*')
    .eq('client_id', clientId)
    .single();
  
  // Get earnings history
  const { data: earnings, error: earningsError } = await supabase
    .from('social_security_earnings')
    .select('*')
    .eq('client_id', clientId)
    .order('work_year', { ascending: false });
  
  if (ssError && ssError.code !== 'PGRST116') {
    console.error('Error fetching SS data:', ssError);
    return;
  }
  
  if (!ssData) {
    console.log('\n⚠️  No Social Security data found for this client.');
    console.log('   Use --action add-manual to add data.\n');
    return;
  }
  
  console.log('\n📊 Social Security Information');
  console.log('═'.repeat(60));
  
  // Personal Info
  console.log('\n👤 Personal Information:');
  console.log(`   Birth Date: ${moment(ssData.birth_date).format('MMMM D, YYYY')}`);
  const fra = ssData.full_retirement_age;
  if (fra) {
    console.log(`   Full Retirement Age: ${Math.floor(fra/12)} years, ${fra % 12} months`);
  }
  console.log(`   Data Source: ${ssData.data_source}`);
  if (ssData.statement_date) {
    console.log(`   Statement Date: ${moment(ssData.statement_date).format('MMMM D, YYYY')}`);
  }
  
  // Benefits
  console.log('\n💰 Estimated Monthly Benefits:');
  console.log('─'.repeat(40));
  for (let age = 62; age <= 70; age++) {
    const benefit = ssData[`benefit_age_${age}`];
    if (benefit) {
      const marker = age === 67 ? ' (FRA)' : '';
      console.log(`   Age ${age}${marker}: $${parseFloat(benefit).toLocaleString()}/month`);
    }
  }
  
  if (ssData.primary_insurance_amount) {
    console.log(`\n   Primary Insurance Amount (PIA): $${parseFloat(ssData.primary_insurance_amount).toLocaleString()}`);
  }
  
  // Disability & Survivor
  console.log('\n🛡️  Other Benefits:');
  if (ssData.disability_benefit) {
    console.log(`   Disability Benefit: $${parseFloat(ssData.disability_benefit).toLocaleString()}/month`);
  }
  if (ssData.survivor_benefit) {
    console.log(`   Survivor Benefit: $${parseFloat(ssData.survivor_benefit).toLocaleString()}/month`);
  }
  
  // Medicare
  console.log('\n🏥 Medicare Status:');
  console.log(`   Credits Earned: ${ssData.medicare_credits || 0}/40`);
  console.log(`   Medicare Eligible: ${ssData.medicare_eligible ? '✅ Yes' : '❌ No (need 40 credits)'}`);
  
  // Totals Paid
  console.log('\n💵 Total Contributions:');
  console.log(`   Your SS Paid: $${parseFloat(ssData.total_social_security_paid || 0).toLocaleString()}`);
  console.log(`   Your Medicare Paid: $${parseFloat(ssData.total_medicare_paid || 0).toLocaleString()}`);
  console.log(`   Employer SS Match: $${parseFloat(ssData.total_employer_ss_paid || 0).toLocaleString()}`);
  console.log(`   Employer Medicare Match: $${parseFloat(ssData.total_employer_medicare_paid || 0).toLocaleString()}`);
  
  const totalContributions = 
    parseFloat(ssData.total_social_security_paid || 0) +
    parseFloat(ssData.total_medicare_paid || 0) +
    parseFloat(ssData.total_employer_ss_paid || 0) +
    parseFloat(ssData.total_employer_medicare_paid || 0);
  console.log(`   ─────────────────────────────`);
  console.log(`   Total Contributions: $${totalContributions.toLocaleString()}`);
  
  // Earnings History
  if (earnings && earnings.length > 0) {
    console.log('\n📈 Earnings History (Recent 10 years):');
    console.log('─'.repeat(60));
    console.log('Year'.padEnd(8) + 'SS Earnings'.padEnd(15) + 'SS Tax'.padEnd(12) + 'Medicare'.padEnd(12) + 'Credits');
    console.log('─'.repeat(60));
    
    earnings.slice(0, 10).forEach(e => {
      console.log(
        `${e.work_year}`.padEnd(8) +
        `$${parseFloat(e.taxed_social_security_earnings || 0).toLocaleString()}`.padEnd(15) +
        `$${parseFloat(e.social_security_tax_paid || 0).toLocaleString()}`.padEnd(12) +
        `$${parseFloat(e.medicare_tax_paid || 0).toLocaleString()}`.padEnd(12) +
        `${e.credits_earned || 0}`
      );
    });
    
    if (earnings.length > 10) {
      console.log(`   ... and ${earnings.length - 10} more years`);
    }
  }
  
  console.log('\n' + '═'.repeat(60) + '\n');
}

/**
 * Add SS data manually with projection
 */
async function addManualData(clientId, birthdate, income) {
  const supabase = getDatabase();
  
  const birthDate = moment(birthdate);
  const birthYear = birthDate.year();
  const currentAge = moment().diff(birthDate, 'years');
  
  // Calculate FRA
  const fra = getFullRetirementAge(birthYear);
  const fraMonths = (fra.years * 12) + fra.months;
  
  // Estimate PIA from income
  const estimatedPIA = estimatePIAFromIncome(income, currentAge);
  
  // Calculate benefits at each age
  const benefits = {};
  for (let age = 62; age <= 70; age++) {
    benefits[`benefit_age_${age}`] = calculateBenefitAtAge(estimatedPIA, fraMonths, age * 12);
  }
  
  // Estimate disability benefit (roughly equals PIA)
  const disabilityBenefit = estimatedPIA;
  
  // Estimate survivor benefit (100% of PIA for surviving spouse at FRA)
  const survivorBenefit = estimatedPIA;
  
  // Estimate work credits (4 per year of work)
  const workYears = Math.max(0, currentAge - 18); // Assume working since 18
  const estimatedCredits = Math.min(workYears * 4, 160); // Cap at 40 years
  
  const ssData = {
    client_id: clientId,
    birth_date: birthDate.format('YYYY-MM-DD'),
    full_retirement_age: fraMonths,
    primary_insurance_amount: estimatedPIA,
    ...benefits,
    disability_benefit: disabilityBenefit,
    survivor_benefit: survivorBenefit,
    medicare_credits: estimatedCredits,
    medicare_eligible: estimatedCredits >= 40,
    data_source: 'projection',
  };
  
  const { data, error } = await supabase
    .from('social_security')
    .upsert(ssData, { onConflict: 'client_id' })
    .select()
    .single();
  
  if (error) {
    console.error('Error saving SS data:', error);
    return;
  }
  
  console.log('\n✅ Social Security projection saved!');
  console.log(`   Birth Date: ${birthDate.format('MMMM D, YYYY')}`);
  console.log(`   Current Age: ${currentAge}`);
  console.log(`   Full Retirement Age: ${fra.years} years, ${fra.months} months`);
  console.log(`   Estimated PIA: $${estimatedPIA.toLocaleString()}/month`);
  console.log(`   Benefit at 62: $${benefits.benefit_age_62.toLocaleString()}/month`);
  console.log(`   Benefit at 67: $${benefits.benefit_age_67.toLocaleString()}/month`);
  console.log(`   Benefit at 70: $${benefits.benefit_age_70.toLocaleString()}/month`);
  console.log(`   Medicare Eligible: ${estimatedCredits >= 40 ? 'Yes' : 'No'} (${estimatedCredits} credits)\n`);
}

/**
 * Add earnings for a specific year
 */
async function addEarnings(clientId, year, earnings) {
  const supabase = getDatabase();
  
  // Cap SS earnings at wage base
  const ssEarnings = Math.min(earnings, SS_CONSTANTS.SS_WAGE_BASE);
  const medicareEarnings = earnings; // No cap for Medicare
  
  // Calculate taxes
  const ssTax = ssEarnings * SS_CONSTANTS.SS_TAX_RATE;
  const medicareTax = medicareEarnings * SS_CONSTANTS.MEDICARE_TAX_RATE;
  
  // Credits earned
  const credits = calculateCredits(earnings);
  
  const earningsData = {
    client_id: clientId,
    work_year: year,
    taxed_social_security_earnings: ssEarnings,
    taxed_medicare_earnings: medicareEarnings,
    social_security_tax_paid: ssTax,
    medicare_tax_paid: medicareTax,
    employer_ss_paid: ssTax,  // Employer matches
    employer_medicare_paid: medicareTax,
    credits_earned: credits,
  };
  
  const { data, error } = await supabase
    .from('social_security_earnings')
    .upsert(earningsData, { onConflict: 'client_id,work_year' })
    .select()
    .single();
  
  if (error) {
    console.error('Error saving earnings:', error);
    return;
  }
  
  // Update totals in main SS table
  await updateTotals(clientId);
  
  console.log(`\n✅ Earnings for ${year} saved!`);
  console.log(`   Earnings: $${earnings.toLocaleString()}`);
  console.log(`   SS Taxable: $${ssEarnings.toLocaleString()}`);
  console.log(`   SS Tax Paid: $${ssTax.toLocaleString()} (+ $${ssTax.toLocaleString()} employer)`);
  console.log(`   Medicare Tax: $${medicareTax.toLocaleString()} (+ $${medicareTax.toLocaleString()} employer)`);
  console.log(`   Credits Earned: ${credits}\n`);
}

/**
 * Update totals from earnings history
 */
async function updateTotals(clientId) {
  const supabase = getDatabase();
  
  // Get all earnings
  const { data: earnings } = await supabase
    .from('social_security_earnings')
    .select('*')
    .eq('client_id', clientId);
  
  if (!earnings || earnings.length === 0) return;
  
  const totals = earnings.reduce((acc, e) => ({
    total_social_security_paid: acc.total_social_security_paid + parseFloat(e.social_security_tax_paid || 0),
    total_medicare_paid: acc.total_medicare_paid + parseFloat(e.medicare_tax_paid || 0),
    total_employer_ss_paid: acc.total_employer_ss_paid + parseFloat(e.employer_ss_paid || 0),
    total_employer_medicare_paid: acc.total_employer_medicare_paid + parseFloat(e.employer_medicare_paid || 0),
    medicare_credits: acc.medicare_credits + (e.credits_earned || 0),
  }), {
    total_social_security_paid: 0,
    total_medicare_paid: 0,
    total_employer_ss_paid: 0,
    total_employer_medicare_paid: 0,
    medicare_credits: 0,
  });
  
  totals.medicare_eligible = totals.medicare_credits >= 40;
  
  await supabase
    .from('social_security')
    .update(totals)
    .eq('client_id', clientId);
}

/**
 * Add benefits from SS statement manually
 */
async function addStatementBenefits(clientId, benefit62, benefit67, benefit70) {
  const supabase = getDatabase();
  
  // Get existing data
  const { data: existing } = await supabase
    .from('social_security')
    .select('*')
    .eq('client_id', clientId)
    .single();
  
  if (!existing) {
    console.error('❌ No SS data found. Add birthdate first with --action add-manual');
    return;
  }
  
  const fra = existing.full_retirement_age;
  const pia = benefit67; // PIA is benefit at FRA (67)
  
  // Calculate intermediate ages if only some provided
  const updates = {
    data_source: 'statement_parse',
    statement_date: new Date().toISOString().split('T')[0],
    primary_insurance_amount: pia,
  };
  
  if (benefit62) updates.benefit_age_62 = benefit62;
  if (benefit67) updates.benefit_age_67 = benefit67;
  if (benefit70) updates.benefit_age_70 = benefit70;
  
  // Interpolate missing ages if we have enough data
  if (pia && fra) {
    for (let age = 62; age <= 70; age++) {
      if (!updates[`benefit_age_${age}`]) {
        updates[`benefit_age_${age}`] = calculateBenefitAtAge(pia, fra, age * 12);
      }
    }
  }
  
  const { error } = await supabase
    .from('social_security')
    .update(updates)
    .eq('client_id', clientId);
  
  if (error) {
    console.error('Error updating benefits:', error);
    return;
  }
  
  console.log('\n✅ Statement benefits saved!');
  console.log(`   Benefit at 62: $${benefit62?.toLocaleString() || 'N/A'}/month`);
  console.log(`   Benefit at 67: $${benefit67?.toLocaleString() || 'N/A'}/month`);
  console.log(`   Benefit at 70: $${benefit70?.toLocaleString() || 'N/A'}/month\n`);
}

/**
 * Parse currency string to number
 */
function parseCurrency(str) {
  if (!str) return null;
  return parseFloat(str.replace(/[,$]/g, ''));
}

/**
 * Parse SS statement PDF and import to database
 */
async function parseAndImportStatement(clientId, filePath) {
  const supabase = getDatabase();
  
  // Check file exists
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }
  
  console.log(`\n📄 Parsing: ${filePath}`);
  
  // Read and parse PDF
  const dataBuffer = fs.readFileSync(filePath);
  let pdfData;
  try {
    pdfData = await pdfParse(dataBuffer);
  } catch (error) {
    console.error('❌ Error parsing PDF:', error.message);
    return;
  }
  
  const text = pdfData.text;
  console.log(`   Pages: ${pdfData.numpages}, Characters: ${text.length.toLocaleString()}`);
  
  // Extract personal info
  let birthDate = null;
  let birthMatch = text.match(/(?:date of birth|born)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  if (birthMatch) {
    birthDate = moment(birthMatch[1], ['MMMM D, YYYY', 'MMMM D YYYY']).format('YYYY-MM-DD');
  }
  
  // Extract current income assumption
  let currentIncome = null;
  let incomeMatch = text.match(/(?:continue to earn|earning)\s*\$?([\d,]+)\s*(?:per year|annually)/i);
  if (incomeMatch) {
    currentIncome = parseCurrency(incomeMatch[1]);
  }
  
  // Extract benefits
  const benefits = {};
  const agePattern = /(?:age\s*)?(\d{2})\s*[:\s]+\$?([\d,]+)(?:\s*(?:a month|monthly|per month))?/gi;
  let ageMatch;
  while ((ageMatch = agePattern.exec(text)) !== null) {
    const age = parseInt(ageMatch[1]);
    const amount = parseCurrency(ageMatch[2]);
    if (age >= 62 && age <= 70 && amount > 100 && amount < 10000) {
      benefits[age] = benefits[age] || amount;
    }
  }
  
  // Extract disability benefit
  let disability = null;
  let disabilityMatch = text.match(/(?:payment would be about|disability benefit[:\s]+)\$?([\d,]+)/i);
  if (disabilityMatch) {
    disability = parseCurrency(disabilityMatch[1]);
  }
  
  // Extract survivor benefits
  let survivorSpouse = null;
  let survivorChild = null;
  let familyMax = null;
  
  let match = text.match(/(?:spouse.*?full retirement age)[:\s]*\$?([\d,]+)/i);
  if (match) survivorSpouse = parseCurrency(match[1]);
  
  match = text.match(/(?:minor child)[:\s]*\$?([\d,]+)/i);
  if (match) survivorChild = parseCurrency(match[1]);
  
  match = text.match(/(?:family benefits cannot be more than)[:\s]*\$?([\d,]+)/i);
  if (match) familyMax = parseCurrency(match[1]);
  
  // Extract Medicare credits
  let medicareCredits = null;
  let creditsMatch = text.match(/(\d+)\s*(?:credits?|quarters?)/i);
  if (creditsMatch) {
    medicareCredits = parseInt(creditsMatch[1]);
  }
  
  // Extract earnings history
  const earnings = [];
  
  // Year range format (1991-2000$9,688$9,688)
  const rangePattern = /(\d{4})-(\d{4})\$?([\d,]+)\$?([\d,]+)/g;
  while ((match = rangePattern.exec(text)) !== null) {
    const startYear = parseInt(match[1]);
    const endYear = parseInt(match[2]);
    if (startYear >= 1950 && endYear <= 2030) {
      earnings.push({
        yearStart: startYear,
        yearEnd: endYear,
        ssEarnings: parseCurrency(match[3]),
        medicareEarnings: parseCurrency(match[4]),
        isRange: true
      });
    }
  }
  
  // Single year format (2006$31,433$31,433)
  const singlePattern = /(?<!\d)(\d{4})\$?([\d,]+)\$?([\d,]+)(?!\d)/g;
  while ((match = singlePattern.exec(text)) !== null) {
    const year = parseInt(match[1]);
    const ssEarnings = parseCurrency(match[2]);
    if (year >= 1950 && year <= 2030 && ssEarnings > 100 && ssEarnings < 500000) {
      const inRange = earnings.some(e => e.isRange && year >= e.yearStart && year <= e.yearEnd);
      if (!inRange) {
        earnings.push({
          year,
          ssEarnings,
          medicareEarnings: parseCurrency(match[3]),
          isRange: false
        });
      }
    }
  }
  
  console.log('\n📊 Extracted Data:');
  console.log('─'.repeat(50));
  if (birthDate) console.log(`   Birth Date: ${birthDate}`);
  if (currentIncome) console.log(`   Current Income: $${currentIncome.toLocaleString()}`);
  console.log(`   Benefits found: Ages ${Object.keys(benefits).join(', ')}`);
  if (disability) console.log(`   Disability: $${disability.toLocaleString()}/month`);
  if (survivorSpouse) console.log(`   Survivor (Spouse): $${survivorSpouse.toLocaleString()}/month`);
  if (survivorChild) console.log(`   Survivor (Child): $${survivorChild.toLocaleString()}/month`);
  if (medicareCredits) console.log(`   Medicare Credits: ${medicareCredits}`);
  console.log(`   Earnings records: ${earnings.length}`);
  
  // Calculate FRA if we have birth date
  let fraMonths = null;
  if (birthDate) {
    const birthYear = moment(birthDate).year();
    const fra = getFullRetirementAge(birthYear);
    fraMonths = (fra.years * 12) + fra.months;
  }
  
  // Save main SS data
  console.log('\n💾 Saving to database...');
  
  const ssData = {
    client_id: clientId,
    birth_date: birthDate || moment().subtract(40, 'years').format('YYYY-MM-DD'),
    full_retirement_age: fraMonths,
    benefit_age_62: benefits[62] || null,
    benefit_age_63: benefits[63] || null,
    benefit_age_64: benefits[64] || null,
    benefit_age_65: benefits[65] || null,
    benefit_age_66: benefits[66] || null,
    benefit_age_67: benefits[67] || null,
    benefit_age_68: benefits[68] || null,
    benefit_age_69: benefits[69] || null,
    benefit_age_70: benefits[70] || null,
    primary_insurance_amount: benefits[67] || null,
    disability_benefit: disability,
    survivor_benefit: survivorSpouse || survivorChild,
    medicare_credits: medicareCredits,
    medicare_eligible: medicareCredits >= 40,
    data_source: 'statement_parse',
    statement_date: new Date().toISOString().split('T')[0],
  };
  
  const { error: ssError } = await supabase
    .from('social_security')
    .upsert(ssData, { onConflict: 'client_id' });
  
  if (ssError) {
    console.error('❌ Error saving SS data:', ssError);
    return;
  }
  console.log('   ✅ Main SS data saved');
  
  // Save earnings history
  let earningsSaved = 0;
  for (const e of earnings) {
    if (e.isRange) {
      // For ranges, we'll save as the end year with the total
      const earningsData = {
        client_id: clientId,
        work_year: e.yearEnd,
        taxed_social_security_earnings: e.ssEarnings,
        taxed_medicare_earnings: e.medicareEarnings,
        social_security_tax_paid: e.ssEarnings * SS_CONSTANTS.SS_TAX_RATE,
        medicare_tax_paid: e.medicareEarnings * SS_CONSTANTS.MEDICARE_TAX_RATE,
        employer_ss_paid: e.ssEarnings * SS_CONSTANTS.SS_TAX_RATE,
        employer_medicare_paid: e.medicareEarnings * SS_CONSTANTS.MEDICARE_TAX_RATE,
        credits_earned: Math.min(4, Math.floor(e.ssEarnings / SS_CONSTANTS.CREDIT_AMOUNT)),
      };
      
      const { error } = await supabase
        .from('social_security_earnings')
        .upsert(earningsData, { onConflict: 'client_id,work_year' });
      
      if (!error) earningsSaved++;
    } else {
      // Single year
      const earningsData = {
        client_id: clientId,
        work_year: e.year,
        taxed_social_security_earnings: e.ssEarnings,
        taxed_medicare_earnings: e.medicareEarnings,
        social_security_tax_paid: e.ssEarnings * SS_CONSTANTS.SS_TAX_RATE,
        medicare_tax_paid: e.medicareEarnings * SS_CONSTANTS.MEDICARE_TAX_RATE,
        employer_ss_paid: e.ssEarnings * SS_CONSTANTS.SS_TAX_RATE,
        employer_medicare_paid: e.medicareEarnings * SS_CONSTANTS.MEDICARE_TAX_RATE,
        credits_earned: Math.min(4, Math.floor(e.ssEarnings / SS_CONSTANTS.CREDIT_AMOUNT)),
      };
      
      const { error } = await supabase
        .from('social_security_earnings')
        .upsert(earningsData, { onConflict: 'client_id,work_year' });
      
      if (!error) earningsSaved++;
    }
  }
  console.log(`   ✅ ${earningsSaved} earnings records saved`);
  
  // Update totals
  await updateTotals(clientId);
  console.log('   ✅ Totals updated');
  
  console.log('\n✅ Import complete! Use --action view to see the data.\n');
}

/**
 * Main function
 */
async function main() {
  console.log('\n🔐 Social Security Manager');
  console.log('═'.repeat(50));
  
  await initDatabase();
  
  const { action, clientId } = CONFIG;
  
  // Actions that don't require a client
  if (action === 'list-clients') {
    await listClients();
    process.exit(0);
  }
  
  // All other actions require a client
  if (!clientId) {
    console.error('\n❌ Please specify a client with --client <id or email>');
    console.log('   Use --action list-clients to see all clients\n');
    process.exit(1);
  }
  
  const client = await findClient(clientId);
  if (!client) {
    process.exit(1);
  }
  
  console.log(`\n👤 Client: ${client.name} (${client.email})`);
  
  switch (action) {
    case 'view':
      await viewSSData(client.client_id);
      break;
      
    case 'add-manual':
      if (!CONFIG.birthdate) {
        console.error('❌ Please provide --birthdate YYYY-MM-DD');
        process.exit(1);
      }
      if (!CONFIG.income) {
        console.error('❌ Please provide --income <annual amount>');
        process.exit(1);
      }
      await addManualData(client.client_id, CONFIG.birthdate, CONFIG.income);
      break;
      
    case 'add-earnings':
      if (!CONFIG.earnings) {
        console.error('❌ Please provide --earnings <amount>');
        process.exit(1);
      }
      await addEarnings(client.client_id, CONFIG.year, CONFIG.earnings);
      break;
      
    case 'add-benefits':
      if (!CONFIG.benefit67) {
        console.error('❌ Please provide at least --benefit-67 <amount>');
        process.exit(1);
      }
      await addStatementBenefits(client.client_id, CONFIG.benefit62, CONFIG.benefit67, CONFIG.benefit70);
      break;
      
    case 'parse-statement':
    case 'import':
      if (!CONFIG.file) {
        console.error('❌ Please provide --file <path to PDF>');
        process.exit(1);
      }
      await parseAndImportStatement(client.client_id, CONFIG.file);
      break;
      
    default:
      console.error(`❌ Unknown action: ${action}`);
      console.log('   Valid actions: list-clients, view, add-manual, add-earnings, add-benefits, import\n');
      process.exit(1);
  }
  
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
