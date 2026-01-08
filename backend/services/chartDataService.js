/**
 * Chart Data Service
 * Aggregates and formats financial data for chart generation
 */

const { getDatabase } = require('../database-supabase');
const moment = require('moment');

/**
 * Get expenses by category for the last N months (stacked bar chart)
 *
 * @param {string} clientId - Client UUID
 * @param {number} months - Number of months to include (default: 12)
 * @returns {Promise<Object>} Chart data with months and categories
 */
async function getExpensesByCategoryChart(clientId, months = 12) {
  const supabase = getDatabase();

  // Calculate date range
  const endDate = moment();
  const startDate = moment().subtract(months, 'months');

  // Query transactions for expenses only
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('month_year, user_category, suggested_category, amount, account_type, date')
    .eq('client_id', clientId)
    .gte('date', startDate.format('YYYY-MM-DD'))
    .lte('date', endDate.format('YYYY-MM-DD'));

  if (error) {
    console.error('Error fetching transactions:', error);
    throw error;
  }

  // Generate array of month labels
  const monthLabels = [];
  for (let i = months - 1; i >= 0; i--) {
    const month = moment().subtract(i, 'months');
    monthLabels.push(month.format('MMM'));
  }

  // Define expense categories (matching transaction categorization)
  const expenseCategories = [
    'housing',
    'billAndUtilities',
    'autoAndTransport',
    'insurance',
    'loanPayment',
    'groceries',
    'healthAndFitness',
    'shopping',
    'diningOut',
    'entertainment',
    'travel',
    'charitableGiving',
    'business',
    'kids',
    'education',
    'gift',
    'misc',
    'feeAndCharges',
    'uncategorized'
  ];

  // Category name mapping for display
  const categoryDisplayNames = {
    housing: 'Housing',
    billAndUtilities: 'Bills & Utilities',
    autoAndTransport: 'Auto & Transport',
    insurance: 'Insurance',
    loanPayment: 'Loan Payment',
    groceries: 'Groceries',
    healthAndFitness: 'Health & Fitness',
    shopping: 'Shopping',
    diningOut: 'Dining Out',
    entertainment: 'Entertainment',
    travel: 'Travel',
    charitableGiving: 'Charitable Giving',
    business: 'Business',
    kids: 'Kids',
    education: 'Education',
    gift: 'Gifts',
    misc: 'Miscellaneous',
    feeAndCharges: 'Fees & Charges',
    uncategorized: 'Uncategorized'
  };

  // Initialize data structure for each category
  const categoryData = {};
  expenseCategories.forEach(cat => {
    categoryData[cat] = new Array(months).fill(0);
  });

  // Aggregate transactions by month and category
  transactions.forEach(transaction => {
    // Determine if transaction is an expense
    const isExpense = transaction.account_type === 'credit' || transaction.amount < 0;
    if (!isExpense) return; // Skip income transactions

    const txDate = moment(transaction.date);
    const monthIndex = months - 1 - moment().diff(txDate, 'months');

    if (monthIndex >= 0 && monthIndex < months) {
      // Use user_category if available, otherwise use suggested_category
      let category = transaction.user_category || transaction.suggested_category || 'uncategorized';

      // Ensure category exists in our structure
      if (!expenseCategories.includes(category)) {
        category = 'uncategorized';
      }

      // Add absolute value of transaction amount
      categoryData[category][monthIndex] += Math.abs(parseFloat(transaction.amount));
    }
  });

  // Format data for chart (only include categories with data)
  const categories = expenseCategories
    .filter(cat => categoryData[cat].some(val => val > 0))
    .map(cat => ({
      name: categoryDisplayNames[cat],
      data: categoryData[cat].map(val => Math.round(val * 100) / 100) // Round to 2 decimals
    }));

  return {
    months: monthLabels,
    categories
  };
}

/**
 * Get income vs expenses for the last N months (bar chart with line overlays)
 *
 * @param {string} clientId - Client UUID
 * @param {number} months - Number of months (default: 12)
 * @returns {Promise<Object>} Chart data with income, expenses, difference, and averages
 */
async function getIncomeVsExpensesChart(clientId, months = 12) {
  const supabase = getDatabase();

  // Calculate date range
  const endDate = moment();
  const startDate = moment().subtract(months, 'months');

  // Query monthly summaries
  const { data: summaries, error } = await supabase
    .from('monthly_summaries')
    .select('month_year, cash_flow, date')
    .eq('client_id', clientId)
    .gte('date', startDate.format('YYYY-MM-DD'))
    .lte('date', endDate.format('YYYY-MM-DD'))
    .order('date', { ascending: true });

  if (error) {
    console.error('Error fetching monthly summaries:', error);
    throw error;
  }

  // Generate month labels and initialize arrays
  const monthLabels = [];
  const income = [];
  const totalExpenses = [];
  const difference = [];

  for (let i = months - 1; i >= 0; i--) {
    const month = moment().subtract(i, 'months');
    const monthKey = month.format('YYYY-MM');
    const monthLabel = month.endOf('month').format('M/D/YYYY');

    monthLabels.push(monthLabel);

    // Find corresponding summary
    const summary = summaries.find(s => s.month_year === monthKey);

    if (summary && summary.cash_flow) {
      income.push(Math.round(summary.cash_flow.income * 100) / 100);
      totalExpenses.push(Math.round(summary.cash_flow.totalExpenses * 100) / 100);
      difference.push(Math.round(summary.cash_flow.difference * 100) / 100);
    } else {
      income.push(0);
      totalExpenses.push(0);
      difference.push(0);
    }
  }

  // Calculate averages (excluding zeros)
  const nonZeroIncome = income.filter(val => val > 0);
  const nonZeroExpenses = totalExpenses.filter(val => val > 0);

  const averageIncome = nonZeroIncome.length > 0
    ? Math.round((nonZeroIncome.reduce((sum, val) => sum + val, 0) / nonZeroIncome.length) * 100) / 100
    : 0;

  const averageExpenses = nonZeroExpenses.length > 0
    ? Math.round((nonZeroExpenses.reduce((sum, val) => sum + val, 0) / nonZeroExpenses.length) * 100) / 100
    : 0;

  return {
    months: monthLabels,
    income,
    totalExpenses,
    difference,
    averageIncome,
    averageExpenses
  };
}

/**
 * Get expense breakdown by category for a date range (pie/doughnut chart)
 *
 * @param {string} clientId - Client UUID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Chart data with categories, amounts, and percentages
 */
async function getExpenseBreakdownChart(clientId, startDate, endDate) {
  const supabase = getDatabase();

  // Query transactions for the date range
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('user_category, suggested_category, amount, account_type')
    .eq('client_id', clientId)
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) {
    console.error('Error fetching transactions:', error);
    throw error;
  }

  // Category name mapping for display
  const categoryDisplayNames = {
    housing: 'Housing',
    billAndUtilities: 'Bills & Utilities',
    autoAndTransport: 'Auto & Transport',
    insurance: 'Insurance',
    loanPayment: 'Loan Payment',
    groceries: 'Groceries',
    healthAndFitness: 'Health & Fitness',
    shopping: 'Shopping',
    diningOut: 'Dining Out',
    entertainment: 'Entertainment',
    travel: 'Travel',
    charitableGiving: 'Charitable Giving',
    business: 'Business',
    kids: 'Kids',
    education: 'Education',
    gift: 'Gifts',
    misc: 'Miscellaneous',
    feeAndCharges: 'Fees & Charges',
    uncategorized: 'Uncategorized'
  };

  // Aggregate expenses by category
  const categoryTotals = {};

  transactions.forEach(transaction => {
    // Determine if transaction is an expense
    const isExpense = transaction.account_type === 'credit' || transaction.amount < 0;
    if (!isExpense) return;

    const category = transaction.user_category || transaction.suggested_category || 'uncategorized';
    const amount = Math.abs(parseFloat(transaction.amount));

    if (!categoryTotals[category]) {
      categoryTotals[category] = 0;
    }
    categoryTotals[category] += amount;
  });

  // Calculate total expenses
  const totalExpenses = Object.values(categoryTotals).reduce((sum, val) => sum + val, 0);

  // Format as array with percentages, sorted by amount descending
  const categories = Object.entries(categoryTotals)
    .map(([cat, amount]) => ({
      name: categoryDisplayNames[cat] || cat,
      amount: Math.round(amount * 100) / 100,
      percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.amount - a.amount);

  // Determine period label
  const startMoment = moment(startDate);
  const endMoment = moment(endDate);
  const diffMonths = endMoment.diff(startMoment, 'months');

  let period;
  if (diffMonths >= 11 && diffMonths <= 13) {
    period = 'Last 12 Months';
  } else if (diffMonths === 0) {
    period = startMoment.format('MMMM YYYY');
  } else {
    period = `${startMoment.format('MMM YYYY')} - ${endMoment.format('MMM YYYY')}`;
  }

  return {
    period,
    categories
  };
}

/**
 * Get net worth history over time (line chart)
 *
 * @param {string} clientId - Client UUID
 * @param {number} months - Number of months (default: 24)
 * @param {boolean} includeSocialSecurity - Include SS present value (default: false)
 * @returns {Promise<Object>} Chart data with net worth, assets, liabilities over time
 */
async function getNetWorthHistoryChart(clientId, months = 24, includeSocialSecurity = false) {
  const supabase = getDatabase();

  // Calculate date range
  const endDate = moment();
  const startDate = moment().subtract(months, 'months');

  // Query balance sheets
  const { data: balanceSheets, error: bsError } = await supabase
    .from('balance_sheets')
    .select('snapshot_date, assets, liabilities, net_worth')
    .eq('client_id', clientId)
    .gte('snapshot_date', startDate.format('YYYY-MM-DD'))
    .lte('snapshot_date', endDate.format('YYYY-MM-DD'))
    .order('snapshot_date', { ascending: true });

  if (bsError) {
    console.error('Error fetching balance sheets:', error);
    throw bsError;
  }

  // Query Social Security data if requested
  let socialSecurityPV = null;
  if (includeSocialSecurity) {
    const { data: ssData, error: ssError } = await supabase
      .from('social_security_data')
      .select('present_value_of_benefits')
      .eq('client_id', clientId)
      .single();

    if (!ssError && ssData) {
      socialSecurityPV = ssData.present_value_of_benefits || 0;
    }
  }

  // Format data for chart
  const years = balanceSheets.map(bs => moment(bs.snapshot_date).format('YYYY'));
  const netWorth = balanceSheets.map(bs => Math.round((bs.net_worth || 0) * 100) / 100);
  const assets = balanceSheets.map(bs => Math.round((bs.assets || 0) * 100) / 100);
  const liabilities = balanceSheets.map(bs => Math.round((bs.liabilities || 0) * 100) / 100);

  const result = {
    years,
    netWorth,
    assets,
    liabilities
  };

  if (includeSocialSecurity && socialSecurityPV !== null) {
    result.socialSecurityPV = Math.round(socialSecurityPV * 100) / 100;
  }

  return result;
}

module.exports = {
  getExpensesByCategoryChart,
  getIncomeVsExpensesChart,
  getExpenseBreakdownChart,
  getNetWorthHistoryChart
};
