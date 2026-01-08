const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const Client = require('../models-supabase/Client');
const MonthlySummary = require('../models-supabase/MonthlySummary');
const moment = require('moment');

// Initialize Plaid client
const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV] || PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

class TransactionProcessor {
  
  // Map Plaid categories to your expense categories
  static categorizeTransaction(transaction, accountType = null) {
    const plaidCategory = transaction.category ? transaction.category[0] : 'Other';
    const subCategory = transaction.category ? transaction.category[1] : '';
    const merchantName = (transaction.merchant_name || transaction.name || '').toLowerCase();
    const amount = Math.abs(transaction.amount);
    
    // Determine if transaction is income or expense based on account type and amount sign
    // According to Plaid documentation:
    // - Deposit accounts (depository): positive = credit (income), negative = debit (expense)
    // - Credit accounts: positive = charge (expense), negative = payment (reduces debt)
    // 
    // We should rely on Plaid's data structure, not hardcoded assumptions about merchants
    
    let isIncome = false;
    
    // Use account type to determine income/expense based on amount sign
    // CREDIT ACCOUNTS:
    //   - Positive amount = charge/purchase (EXPENSE)
    //   - Negative amount = payment (reduces debt, but still money going out = EXPENSE for cash flow)
    // DEPOSITORY ACCOUNTS (checking, savings):
    //   - Positive amount = deposit/credit (INCOME)
    //   - Negative amount = withdrawal/debit (EXPENSE)
    // LOAN ACCOUNTS:
    //   - Positive amount = loan disbursement (INCOME)
    //   - Negative amount = loan payment (EXPENSE)
    
    if (accountType === 'credit') {
      // Credit cards: positive = charge (expense), negative = payment (expense for cash flow)
      isIncome = false;
    } else if (accountType === 'depository') {
      // Checking/savings: positive = income, negative = expense
      isIncome = transaction.amount > 0;
    } else if (accountType === 'loan') {
      // Loans: positive = loan received (income), negative = payment (expense)
      isIncome = transaction.amount > 0;
    } else {
      // Default: if account type is unknown, use amount sign
      // Positive = likely income, negative = likely expense
      isIncome = transaction.amount > 0;
    }
    
    if (isIncome) {
      return { category: 'income', subCategory: 'income', amount: amount };
    }

    let finalCategory = 'uncategorized';

    // Combine merchant name and transaction name for searching
    const transactionName = (transaction.merchant_name || transaction.name || '').toLowerCase();
    const searchName = transactionName;
    
    // Map to your specific categories
    if (searchName.includes('rent') || searchName.includes('mortgage') || 
        searchName.includes('property tax')) {
      finalCategory = 'housing';
    }
    else if (searchName.includes('electric') || searchName.includes('gas company') ||
             searchName.includes('water') || searchName.includes('internet') ||
             searchName.includes('phone') || searchName.includes('cable')) {
      finalCategory = 'billAndUtilities';
    }
    else if (searchName.includes('uber') || searchName.includes('lyft') ||
             searchName.includes('parking')) {
      finalCategory = 'autoAndTransport';
    }
    else if (searchName.includes('gas') && !searchName.includes('gas company')) {
      finalCategory = 'autoAndTransport';
    }
    else if (searchName.includes('insurance') || searchName.includes('allstate') ||
             searchName.includes('geico')) {
      finalCategory = 'insurance';
    }
    else if (searchName.includes('credit card') && 
             (searchName.includes('payment') || searchName.includes('pay'))) {
      finalCategory = 'loanPayment';
    }
    else if (searchName.includes('loan') || searchName.includes('payment -')) {
      finalCategory = 'loanPayment';
    }
    else if (searchName.includes('grocery') || searchName.includes('supermarket')) {
      finalCategory = 'groceries';
    }
    else if (searchName.includes('doctor') || searchName.includes('pharmacy') ||
             searchName.includes('gym') || searchName.includes('fitness')) {
      finalCategory = 'healthAndFitness';
    }
    // Shopping/retail
    else if (searchName.includes('amazon') || searchName.includes('target') ||
             searchName.includes('sparkfun') || searchName.includes('shop') ||
             searchName.includes('bicycle') || searchName.includes('store')) {
      finalCategory = 'shopping';
    }
    // Dining out
    else if (searchName.includes('restaurant') || searchName.includes('mcdonald') ||
             searchName.includes("mcdonald's") || searchName.includes('starbucks') ||
             searchName.includes('kfc') || searchName.includes('kentucky fried')) {
      finalCategory = 'diningOut';
    }
    else if (searchName.includes('netflix') || searchName.includes('spotify') ||
             searchName.includes('movie')) {
      finalCategory = 'entertainment';
    }
    // Travel
    else if (searchName.includes('airline') || searchName.includes('airlines') ||
             searchName.includes('united airlines') || searchName.includes('hotel')) {
      finalCategory = 'travel';
    }
    // Recreation/activities
    else if (searchName.includes('climbing') || searchName.includes('touchstone')) {
      finalCategory = 'entertainment';
    }
    else if (searchName.includes('church') || searchName.includes('charity')) {
      finalCategory = 'charitableGiving';
    }
    else if (searchName.includes('fee') || searchName.includes('charge') ||
             searchName.includes('overdraft') || searchName.includes('intrst')) {
      finalCategory = 'feeAndCharges';
    }

    return { category: 'expense', subCategory: finalCategory, amount: amount };
  }

  // Process transactions for a specific client and month
  static async processClientMonth(clientId, targetMonth = null) {
    try {
      console.log(`📊 Processing transactions for client: ${clientId}`);
      
      // Get client data
      const client = await Client.findOne({ clientId });
      if (!client) {
        throw new Error('Client not found');
      }

      // Determine target month (default to current month)
      const month = targetMonth || moment().format('YYYY-MM');
      const year = parseInt(month.split('-')[0]);
      const monthNum = parseInt(month.split('-')[1]);
      
      // Date range for the month
      const startDate = moment(`${year}-${monthNum.toString().padStart(2, '0')}-01`).format('YYYY-MM-DD');
      const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');
      
      console.log(`📅 Processing month: ${month} (${startDate} to ${endDate})`);

      // Initialize monthly data structure to match schema
      let monthlyData = {
        clientId,
        monthYear: month,
        date: new Date(endDate), 
        year,
        
        // Cash flow structure matching schema
        cashFlow: {
          averageExpense: 0,
          averageIncome: 0,
          difference: 0,
          income: 0,
          totalExpenses: 0,
          
          // All expense categories
          housing: 0,
          billAndUtilities: 0,
          autoAndTransport: 0,
          insurance: 0,
          loanPayment: 0,
          groceries: 0,
          healthAndFitness: 0,
          shopping: 0,
          diningOut: 0,
          entertainment: 0,
          travel: 0,
          misc: 0,
          charitableGiving: 0,
          business: 0,
          kids: 0,
          education: 0,
          gift: 0,
          uncategorized: 0,
          feeAndCharges: 0
        },
        
        // Net worth structure matching schema
        netWorth: {
          assets: 0,
          liabilities: 0,
          netWorth: 0,
          difference: 0,
          
          assetBreakdown: {
            checking: 0,
            savings: 0,
            investments: 0,
            realEstate: 0,
            total: 0
          },
          
          liabilityBreakdown: {
            creditCards: 0,
            studentLoans: 0,
            mortgage: 0,
            total: 0
          }
        },
        
        transactionsProcessed: 0
      };

      // Fetch transactions from database instead of Plaid API
      // This uses the transactions that were already synced via transactionsSync
      const Transaction = require('../models-supabase/Transaction');
      const transactions = await Transaction.find({
        clientId,
        monthYear: month
      });

      console.log(`📄 Found ${transactions.length} unique transactions in database for ${month}`);

      // Process transactions from database
      // Include ALL transactions regardless of isReviewed status
      for (const transaction of transactions) {
        const accountType = transaction.accountType || null;
        const amount = Math.abs(transaction.amount);
        // Prioritize userCategory (from review) over suggestedCategory
        const category = transaction.userCategory || transaction.suggestedCategory || 'uncategorized';
        
        // Determine if income or expense based on account type and amount sign
        let isIncome = false;
        
        if (accountType === 'credit') {
          // Credit cards: positive = charge (expense), negative = payment (expense)
          isIncome = false;
        } else if (accountType === 'depository') {
          // Checking/savings: positive = income, negative = expense
          isIncome = transaction.amount > 0;
        } else if (accountType === 'loan') {
          // Loans: positive = loan received (income), negative = payment (expense)
          isIncome = transaction.amount > 0;
        } else {
          // Default: positive = income, negative = expense
          isIncome = transaction.amount > 0;
        }
        
        if (isIncome) {
          monthlyData.cashFlow.income += amount;
        } else {
          // Map category to correct field name
          if (category === 'billAndUtilities') {
            monthlyData.cashFlow.billAndUtilities += amount;
          } else if (category === 'autoAndTransport') {
            monthlyData.cashFlow.autoAndTransport += amount;
          } else if (category === 'healthAndFitness') {
            monthlyData.cashFlow.healthAndFitness += amount;
          } else if (category === 'feeAndCharges') {
            monthlyData.cashFlow.feeAndCharges += amount;
          } else if (category === 'miscellaneous') {
            monthlyData.cashFlow.misc += amount;
          } else if (monthlyData.cashFlow[category] !== undefined) {
            monthlyData.cashFlow[category] += amount;
          } else {
            monthlyData.cashFlow.uncategorized += amount;
          }
        }
      }

      // Calculate net worth from account balances
      // Fetch account balances from Plaid for active connections
      for (const plaidConnection of client.plaidAccessTokens) {
        if (!plaidConnection.isActive) continue;
        
        try {
          const accountsResponse = await plaidClient.accountsGet({
            access_token: plaidConnection.accessToken
          });
          
          for (const account of accountsResponse.data.accounts) {
            const balance = account.balances.current || 0;
            
            switch (account.type) {
              case 'depository':
                if (account.subtype === 'checking') {
                  monthlyData.netWorth.assetBreakdown.checking += balance;
                } else if (account.subtype === 'savings') {
                  monthlyData.netWorth.assetBreakdown.savings += balance;
                }
                break;
              case 'investment':
                monthlyData.netWorth.assetBreakdown.investments += balance;
                break;
              case 'credit':
                monthlyData.netWorth.liabilityBreakdown.creditCards += Math.abs(balance);
                break;
              case 'loan':
                if (account.subtype === 'mortgage') {
                  monthlyData.netWorth.liabilityBreakdown.mortgage += Math.abs(balance);
                } else if (account.subtype === 'student') {
                  monthlyData.netWorth.liabilityBreakdown.studentLoans += Math.abs(balance);
                }
                break;
            }
          }
        } catch (error) {
          console.error(`❌ Error fetching account balances from ${plaidConnection.institutionName}:`, error.message);
        }
      }

      // Calculate totals for breakdown objects
      monthlyData.netWorth.assetBreakdown.total = 
        monthlyData.netWorth.assetBreakdown.checking + 
        monthlyData.netWorth.assetBreakdown.savings + 
        monthlyData.netWorth.assetBreakdown.investments + 
        monthlyData.netWorth.assetBreakdown.realEstate;

      monthlyData.netWorth.liabilityBreakdown.total = 
        monthlyData.netWorth.liabilityBreakdown.creditCards + 
        monthlyData.netWorth.liabilityBreakdown.studentLoans + 
        monthlyData.netWorth.liabilityBreakdown.mortgage;

      // Set the main totals (these are what the schema expects as numbers)
      monthlyData.netWorth.assets = monthlyData.netWorth.assetBreakdown.total;
      monthlyData.netWorth.liabilities = monthlyData.netWorth.liabilityBreakdown.total;
      monthlyData.netWorth.netWorth = monthlyData.netWorth.assets - monthlyData.netWorth.liabilities;

      // Calculate cash flow totals
      monthlyData.cashFlow.totalExpenses = 
        monthlyData.cashFlow.housing + monthlyData.cashFlow.billAndUtilities + 
        monthlyData.cashFlow.autoAndTransport + monthlyData.cashFlow.insurance +
        monthlyData.cashFlow.loanPayment + monthlyData.cashFlow.groceries +
        monthlyData.cashFlow.healthAndFitness + monthlyData.cashFlow.shopping +
        monthlyData.cashFlow.diningOut + monthlyData.cashFlow.entertainment +
        monthlyData.cashFlow.travel + monthlyData.cashFlow.misc + 
        monthlyData.cashFlow.charitableGiving + monthlyData.cashFlow.business +
        monthlyData.cashFlow.kids + monthlyData.cashFlow.education + 
        monthlyData.cashFlow.gift + monthlyData.cashFlow.uncategorized + 
        monthlyData.cashFlow.feeAndCharges;

      monthlyData.cashFlow.difference = monthlyData.cashFlow.income - monthlyData.cashFlow.totalExpenses;
      monthlyData.transactionsProcessed = transactions.length;

      // Save to database
      const savedSummary = await MonthlySummary.findOneAndUpdate(
        { clientId, monthYear: month },
        monthlyData,
        { upsert: true, new: true }
      );

      console.log(`✅ Successfully processed ${transactions.length} transactions for ${month}`);
      console.log(`💰 Income: $${monthlyData.cashFlow.income.toFixed(2)}`);
      console.log(`💸 Expenses: $${monthlyData.cashFlow.totalExpenses.toFixed(2)}`);
      console.log(`💎 Net Worth: $${monthlyData.netWorth.netWorth.toFixed(2)}`);

      return savedSummary;

    } catch (error) {
      console.error('❌ Error processing client month:', error);
      throw error;
    }
  }

  // Process current month for all active clients
  static async processAllClients() {
    try {
      const clients = await Client.find({ isActive: true });
      console.log(`🔄 Processing ${clients.length} active clients`);

      const results = [];
      for (const client of clients) {
        try {
          const result = await this.processClientMonth(client.clientId);
          results.push({ clientId: client.clientId, success: true, summary: result });
        } catch (error) {
          console.error(`❌ Failed to process client ${client.clientId}:`, error.message);
          results.push({ clientId: client.clientId, success: false, error: error.message });
        }
      }

      return results;
    } catch (error) {
      console.error('❌ Error processing all clients:', error);
      throw error;
    }
  }
}

module.exports = TransactionProcessor;