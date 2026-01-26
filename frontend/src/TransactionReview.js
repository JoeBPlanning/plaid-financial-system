import React, { useState, useEffect } from 'react';
import api from './api';
import { supabase } from './supabaseClient';

// Updated categories to match your schema exactly
const EXPENSE_CATEGORIES = [
  { value: 'housing', label: 'Housing' },
  { value: 'billAndUtilities', label: 'Bills & Utilities' },
  { value: 'autoAndTransport', label: 'Auto & Transport' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'loanPayment', label: 'Loan Payment' },
  { value: 'groceries', label: 'Groceries' },
  { value: 'healthAndFitness', label: 'Health & Fitness' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'diningOut', label: 'Dining Out' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'travel', label: 'Travel' },
  { value: 'charitableGiving', label: 'Charitable Giving' },
  { value: 'business', label: 'Business' },
  { value: 'kids', label: 'Kids' },
  { value: 'education', label: 'Education' },
  { value: 'gift', label: 'Gift' },
  { value: 'feeAndCharges', label: 'Fees & Charges' },
  { value: 'misc', label: 'Miscellaneous' },
  { value: 'uncategorized', label: 'Uncategorized' },
  { value: 'exclude', label: 'Exclude (Refunds/Chargebacks)' }
];

const INCOME_CATEGORIES = [
  { value: 'salary', label: 'Salary/Wages' },
  { value: 'freelance', label: 'Freelance/Contract' },
  { value: 'business', label: 'Business Income' },
  { value: 'investments', label: 'Investment Returns' },
  { value: 'dividends', label: 'Dividends' },
  { value: 'interest', label: 'Interest' },
  { value: 'transfers', label: 'Transfers (Venmo/Family)' },
  { value: 'refunds', label: 'Refunds' },
  { value: 'other', label: 'Other Income' }
];

function TransactionReview({ client, onComplete }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [filter, setFilter] = useState('all'); // 'all', 'unreviewed', 'reviewed'
  const [searchTerm, setSearchTerm] = useState('');
  // eslint-disable-next-line no-unused-vars
  const [rules, setRules] = useState([]); // Rules state is maintained for rule creation logic

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, selectedMonth, filter]); // Re-fetch when filter changes

  const loadTransactions = async () => {
    if (!client) return;
    
    setLoading(true);
    try {
      // Build query params based on the filter state
      const params = new URLSearchParams({ month: selectedMonth });
      if (filter === 'unreviewed') {
        params.append('is_reviewed', 'false');
      } else if (filter === 'reviewed') {
        params.append('is_reviewed', 'true');
      }
      // 'all' sends no is_reviewed param, so backend returns all

      // Fetch both transactions and rules concurrently
      const [transactionResponse, rulesResponse] = await Promise.all([
        api.get(
        `/api/clients/${client.clientId}/transactions?${params.toString()}`
        ),
        supabase.from('transaction_rules').select('*').eq('user_id', client.clientId)
      ]);

      const fetchedRules = rulesResponse.data || [];
      setRules(fetchedRules);

      const processedTransactions = transactionResponse.data.transactions.map(t => {
        let finalCategory = t.userCategory || t.suggestedCategory;
        let appliedRule = null;

        // Apply auto-categorization rules
        for (const rule of fetchedRules) {
          if ((t.name || t.merchantName || '').toLowerCase().includes(rule.keyword.toLowerCase())) {
            finalCategory = rule.assigned_category;
            appliedRule = rule;
            break; // Apply first matching rule
          }
        }

        // Apply new income/transfer logic to set default finalCategory if not already set by user
        const isTransfer = isTransactionTransfer(t);
        const isIncome = isTransactionIncome(t, appliedRule); // Pass applied rule

        if (!t.userCategory && !appliedRule) { // Only suggest if not manually set or ruled
            if (isTransfer) {
                finalCategory = 'transfers';
            } else if (isIncome) {
                const name = (t.name || t.merchantName || '').toLowerCase();
                if (name.includes('stripe') || name.includes('square') || name.includes('paypal')) {
                    finalCategory = 'business';
                } else if (name.includes('electronic deposit') || name.includes('zelle')) {
                    finalCategory = 'other';
                } else {
                    finalCategory = t.suggestedCategory || 'salary';
                }
            } else { // Expense
                finalCategory = t.suggestedCategory || 'uncategorized';
            }
        }

        return {
        ...t,
          finalCategory,
          appliedRule, // Store which rule was applied
          // Ensure isReviewed is properly set based on whether userCategory exists or is newly assigned
          isReviewed: t.isReviewed !== undefined ? t.isReviewed : (!!t.userCategory || !!appliedRule)
        };
      });

      setTransactions(processedTransactions);
    } catch (error) {
      console.error('Error loading transactions:', error);
      alert('Failed to load transactions');
    }
    setLoading(false);
  };

  const updateTransactionCategory = (transactionId, category) => {
    setTransactions(prev => prev.map(t => {
      if (t._id === transactionId) {
        return { 
          ...t, 
          finalCategory: category, 
          isManuallyChanged: true, // Flag for rule creation
          userCategory: category, // Also update userCategory so it persists
          isReviewed: true 
        };
      }
      return t;
    }));
  };

  const saveAndReviewAll = async () => {
    setSaving(true);
    try {
      // Silently create/update rules for manually changed transactions
      const potentialNewRules = transactions.filter(t => t.isManuallyChanged && !t.appliedRule);

      const bulkUpdateKeywords = []; // To store keywords for backend bulk update

      for (const t of potentialNewRules) {
        const merchantName = (t.merchantName || t.name || '').trim();
        if (!merchantName) {
          console.warn('Skipping rule creation for transaction with no merchant name:', t);
          continue; // Skip rule creation if no valid merchant name
        }

        const isIncome = isTransactionIncome(t, t.appliedRule) === true;
        const newRule = {
          user_id: client.clientId,
          keyword: merchantName,
          assigned_category: t.finalCategory,
          is_income: isIncome,
        };

        // Upsert silently: creates a new rule or updates an existing one for the same keyword.
        const { error } = await supabase
          .from('transaction_rules')
          .upsert(newRule, { onConflict: 'user_id, keyword' });

        if (error) {
          console.error('Error saving rule:', error);
        } else {
          // Add to list for backend bulk update
          bulkUpdateKeywords.push({
            keyword: merchantName,
            newCategory: t.finalCategory,
            isIncome: isIncome, // Not strictly needed for backend update, but good for context
          });
        }
      }

      // Prepare all transactions in the current view to be marked as reviewed
      const updatedTransactions = filteredTransactions.map(t => ({
        transactionId: t._id || t.plaidTransactionId, // Use plaidTransactionId as fallback
        userCategory: t.finalCategory || t.userCategory || t.suggestedCategory, // Use finalCategory, existing userCategory, or suggestedCategory
        isReviewed: true // Always mark as reviewed when saving (user has reviewed the transaction)
      }));

      await api.post(`/api/clients/${client.clientId}/update-transaction-categories`, {
        transactions: updatedTransactions,
        month: selectedMonth
      });
      
      // Call backend to apply retroactive updates based on newly created/updated rules
      if (bulkUpdateKeywords.length > 0) {
        try {
          await api.post(`/api/clients/${client.clientId}/bulk-update-by-keyword`, {
            updates: bulkUpdateKeywords,
          });
          console.log('Retroactive bulk update triggered successfully.');
        } catch (bulkUpdateError) {
          console.error('Error during retroactive bulk update:', bulkUpdateError);
          // Don't fail the main save if bulk update fails
        }
      }
      
      // Reload transactions to ensure we have the latest saved data
      await loadTransactions();
      
      // Regenerate summary to reflect the updated categories
      try {
        await api.post(`/api/process-transactions/${client.clientId}`, {
          targetMonth: selectedMonth,
          useUserCategories: true
        });
      } catch (summaryError) {
        console.error('Error regenerating summary:', summaryError);
        // Don't fail the save if summary regeneration fails
      }
      
      alert('Categories saved and applied successfully!');
      if (onComplete) onComplete();
    } catch (error) {
      console.error('Error saving categories:', error);
      alert('Failed to save categories');
    }
    setSaving(false);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Math.abs(amount) || 0);
  };

  const toggleTransactionType = (transactionId) => {
    setTransactions(prev => prev.map(t => {
      if (t._id === transactionId) {
        const isCurrentlyIncome = isTransactionIncome(t, t.appliedRule) === true;
        const isCurrentlyTransfer = isTransactionTransfer(t);

        // If it's a transfer, mark as income. If income, mark as transfer.
        const newTypeOverride = (isCurrentlyTransfer || isCurrentlyIncome === null) ? 'income' : 'transfer';

        return {
          ...t,
          typeOverride: newTypeOverride,
          isManuallyChanged: true,
        };
      }
      return t;
    }));
  };


  // Determine if transaction is a transfer (not income or expense)
  // Transfers include: credit card payments, account transfers, CD deposits, etc.
  const isTransactionTransfer = (transaction) => {
    const name = (transaction.name || transaction.merchantName || '').toLowerCase();
    const pfc = transaction.personalFinanceCategory;
    
    // Credit card payments are transfers (paying off debt, not a new expense)
    if (name.includes('credit card') && name.includes('payment')) {
      return true;
    }
    
    // CD deposits are transfers (moving money between accounts)
    // These are opening a CD account, not a purchase or income
    if (name.includes('cd deposit') || name.includes('cd.deposit') || 
        (name.includes('deposit') && name.includes('initial'))) {
      return true;
    }
    
    // Check Plaid's personal finance category for transfers
    if (pfc && pfc.primary) {
      const primary = pfc.primary.toLowerCase();
      if (primary.includes('transfer_out') || primary.includes('transfer_in') ||
          primary.includes('loan_payment')) {
        return true;
      }
    }
    
    // Account transfers
    if (name.includes('transfer') && (name.includes('account') || name.includes('between'))) {
      return true;
    }
    
    return false;
  };

  // Determine if transaction is income based on account type, Plaid categories, and merchant name
  // According to Plaid: 
  // - Credit accounts: positive = charge (expense), negative = payment (expense for cash flow)
  // - Depository accounts: positive = credit/deposit (income), negative = debit/withdrawal (expense)
  // - Loan accounts: positive = loan disbursement (income), negative = payment (expense)
  // Per user request, this has been simplified to follow the Plaid standard:
  // Negative amount = Inflow (Income), Positive amount = Outflow (Expense)
  const isTransactionIncome = (transaction, appliedRule = null) => {
    const name = (transaction.name || transaction.merchantName || '').toLowerCase();
    const amount = transaction.amount;

    // Rule Override: If a rule is applied, its is_income flag is the source of truth.
    if (appliedRule) {
      return appliedRule.is_income;
    }

    // First, check if it's a transfer, which is neither income nor expense.
    if (isTransactionTransfer(transaction)) {
      return null; // Return null to indicate it's a transfer
    }

    // Handle explicit income keywords for inflows (negative amount in Plaid)
    // Plaid standard: negative is inflow
    const isPlaidInflow = amount < 0;

    // Keyword Overrides: Stripe, Square, PayPal
    if (isPlaidInflow && (name.includes('stripe') || name.includes('square') || name.includes('paypal'))) {
      return true; // Explicitly income
    }

    // Electronic Deposits:
    // If it's an inflow and contains 'electronic deposit', it's income.
    // The "unless it is explicitly a transfer between known linked accounts" part
    // is handled by calling isTransactionTransfer first. If isTransactionTransfer
    // already said it's a transfer, we wouldn't reach here.
    if (isPlaidInflow && name.includes('electronic deposit')) {
      return true; // Explicitly income
    }

    // Handle Zelle transactions explicitly (already there)
    // A negative amount from Zelle is an inflow (income).
    // Handle Zelle transactions explicitly.
    // A negative amount from Zelle is an inflow (income).
    if (name.includes('zelle') && amount < 0) {
      return true; // Explicitly income
    }

    // Apply the standard Plaid logic for all other transactions.
    // A negative amount represents an inflow of money (income), positive is outflow (expense).
    return isPlaidInflow;
  };

  // Filter transactions based on current filter and search
  const filteredTransactions = transactions.filter(transaction => {
    const matchesFilter = filter === 'all' || 
      (filter === 'unreviewed' && !transaction.isReviewed) ||
      (filter === 'reviewed' && transaction.isReviewed);
    
    const matchesSearch = searchTerm === '' || 
      (transaction.name && transaction.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (transaction.merchantName && transaction.merchantName.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return matchesFilter && matchesSearch;
  });

  const unreviewedCount = transactions.filter(t => !t.isReviewed).length;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <p>Loading transactions...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
      <div style={{ 
        background: 'white', 
        borderRadius: '12px', 
        padding: '30px',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)'
      }}>
        <h2 style={{ margin: '0 0 30px 0', color: '#333' }}>
          Review & Categorize Transactions
        </h2>
        
        {/* Controls */}
        <div style={{ 
          display: 'flex', 
          gap: '20px', 
          marginBottom: '30px', 
          flexWrap: 'wrap',
          alignItems: 'center'
        }}>
          <div>
            <label>Month: </label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>
          
          {/* Tabbed Interface for Filter */}
          <div style={{ display: 'flex', border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden' }}>
            <button
              onClick={() => setFilter('unreviewed')}
              style={{
                padding: '8px 16px',
                backgroundColor: filter === 'unreviewed' ? '#667eea' : '#f0f0f0',
                color: filter === 'unreviewed' ? 'white' : '#333',
                border: 'none',
                cursor: 'pointer',
                fontWeight: filter === 'unreviewed' ? 'bold' : 'normal'
              }}
            >
              Unreviewed ({unreviewedCount})
            </button>
            <button
              onClick={() => setFilter('reviewed')}
              style={{
                padding: '8px 16px',
                backgroundColor: filter === 'reviewed' ? '#667eea' : '#f0f0f0',
                color: filter === 'reviewed' ? 'white' : '#333',
                border: 'none',
                cursor: 'pointer',
                fontWeight: filter === 'reviewed' ? 'bold' : 'normal'
              }}
            >
              Reviewed ({transactions.length - unreviewedCount})
            </button>
          </div>
          
          <div>
            <label>Search: </label>
            <input
              type="text"
              placeholder="Search by merchant or description..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ 
                padding: '8px', 
                borderRadius: '4px', 
                border: '1px solid #ccc',
                width: '250px'
              }}
            />
          </div>
        </div>

        {/* Summary */}
        <div style={{ 
          background: '#f8f9fc', 
          padding: '15px', 
          borderRadius: '8px', 
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <strong>Showing {filteredTransactions.length} of {transactions.length} transactions</strong>
            {unreviewedCount > 0 && (
              <span style={{ color: '#ff6b35', marginLeft: '15px' }}>
                {unreviewedCount} unreviewed
              </span>
            )}
          </div>
        </div>

        {/* Transaction List */}
        <div style={{ 
          maxHeight: '500px', 
          overflowY: 'auto',
          border: '1px solid #e1e5e9',
          borderRadius: '8px'
        }}>
          {filteredTransactions.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
              No transactions found for the selected criteria.
            </div>
          ) : (
            filteredTransactions.map(transaction => (
              <div 
                key={transaction._id} 
                style={{ 
                  padding: '15px', 
                  borderBottom: '1px solid #eee',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: transaction.isReviewed ? '#f9f9f9' : '#fff'
                }}
              >
                <div style={{ flex: '2' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '16px' }}>
                    {transaction.merchantName || transaction.name}
                  </div>
                  <div style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
                    {new Date(transaction.date).toLocaleDateString()} | {transaction.accountName || `Account: ${transaction.accountId}`}
                  </div>
                  {transaction.category && transaction.category.length > 0 && (
                    <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>
                      Original: {transaction.category.join(' → ')}
                    </div>
                  )}
                </div>
                
                <div style={{ 
                  flex: '1', 
                  textAlign: 'right', 
                  marginRight: '20px' 
                }}>
                  {(() => {
                    const isTransfer = isTransactionTransfer(transaction);
                    const isIncome = isTransactionIncome(transaction, transaction.appliedRule);
                    // eslint-disable-next-line no-unused-vars
                    const isExpense = !isTransfer && !isIncome;
                    
                    if (isTransfer) {
                      return (
                        <>
                          <div style={{ 
                            fontWeight: 'bold', 
                            fontSize: '16px',
                            color: '#6c757d'
                          }}>
                            {formatCurrency(Math.abs(transaction.amount))}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6c757d' }}>
                            Transfer
                          </div>
                        </>
                      );
                    }
                    
                    return (
                      <>
                        <div style={{ 
                          fontWeight: 'bold', 
                          fontSize: '16px',
                          color: isIncome ? '#28a745' : '#dc3545'
                        }}> 
                          {isIncome ? '+' : ''}{formatCurrency(Math.abs(transaction.amount))}
                        </div>
                        <div style={{ fontSize: '12px', color: isIncome ? '#28a745' : '#dc3545' }}>
                          {isIncome ? 'Income' : 'Expense'}
                        </div>
                      </>
                    );
                  })()}
                </div>
                
                <div style={{ flex: '1', minWidth: '200px', position: 'relative' }}>
                  <select
                    value={transaction.finalCategory}
                    onChange={(e) => updateTransactionCategory(transaction._id, e.target.value)}
                    style={{ 
                      width: '100%', 
                      padding: '8px',
                      borderRadius: '4px',
                      border: '1px solid #ccc',
                      backgroundColor: transaction.isReviewed ? '#e8f5e8' : '#fff'
                    }}
                  >
                    {(() => {
                      const isTransfer = isTransactionTransfer(transaction) && transaction.typeOverride !== 'income';
                      const isIncome = isTransactionIncome(transaction, transaction.appliedRule);
                      
                      // For transfers, show all categories (or could show a "Transfer" category)
                      if (isTransfer) {
                        return (
                          <>
                            <option value="uncategorized">Transfer</option>
                            {EXPENSE_CATEGORIES.map(cat => (
                              <option key={cat.value} value={cat.value}>
                                {cat.label}
                              </option>
                            ))}
                            {INCOME_CATEGORIES.map(cat => (
                              <option key={cat.value} value={cat.value}>
                                {cat.label}
                              </option>
                            ))}
                          </>
                        );
                      }
                      
                      // For income/expense, show appropriate categories
                      return isIncome ? (
                        INCOME_CATEGORIES.map(cat => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))
                      ) : (
                        EXPENSE_CATEGORIES.map(cat => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))
                      );
                    })()}  
                  </select>
                  
                  {transaction.isReviewed && (
                    <div style={{ 
                      fontSize: '11px', 
                      color: '#28a745', 
                      marginTop: '2px' 
                    }}>
                      ✓ Reviewed
                    </div>
                  )}
                  {transaction.appliedRule && (
                    <div style={{
                      fontSize: '10px',
                      color: '#667eea',
                      marginTop: '2px'
                    }}>
                      ✓ Reviewed
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Save Button */}
        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <button 
            onClick={saveCategories} 
            disabled={saving}
            style={{ 
              padding: '15px 30px', 
              backgroundColor: saving ? '#ccc' : '#667eea', 
              color: 'white', 
              border: 'none', 
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: saving ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
            }}
          >
            {saving ? 'Saving Categories...' : 'Save All Categories'}
          </button>
          
          {onComplete && (
            <button 
              onClick={() => onComplete()}
              style={{ 
                padding: '15px 30px', 
                backgroundColor: 'transparent', 
                color: '#667eea', 
                border: '2px solid #667eea', 
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                marginLeft: '15px'
              }}
            >
              Done & Return to Dashboard
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default TransactionReview;