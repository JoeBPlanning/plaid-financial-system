import React, { useState, useEffect } from 'react';
import api from './api';

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

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, selectedMonth]);

  const loadTransactions = async () => {
    if (!client) return;
    
    setLoading(true);
    try {
      const response = await api.get(
        `/api/clients/${client.clientId}/transactions?month=${selectedMonth}`
      );
      setTransactions(response.data.transactions.map(t => ({
        ...t,
        finalCategory: t.userCategory || t.suggestedCategory,
        // Ensure isReviewed is properly set based on whether userCategory exists
        isReviewed: t.isReviewed !== undefined ? t.isReviewed : (t.userCategory ? true : false)
      })));
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
          userCategory: category, // Also update userCategory so it persists
          isReviewed: true 
        };
      }
      return t;
    }));
  };

  const saveCategories = async () => {
    setSaving(true);
    try {
      // Include ALL transactions, marking them as reviewed if they have a category
      const updatedTransactions = transactions.map(t => ({
        transactionId: t._id || t.plaidTransactionId, // Use plaidTransactionId as fallback
        userCategory: t.finalCategory || t.userCategory || t.suggestedCategory, // Use finalCategory, existing userCategory, or suggestedCategory
        isReviewed: true // Always mark as reviewed when saving (user has reviewed the transaction)
      }));

      await api.post(`/api/clients/${client.clientId}/update-transaction-categories`, {
        transactions: updatedTransactions,
        month: selectedMonth
      });
      
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
      
      alert('Categories saved successfully!');
      if (onComplete) onComplete();
    } catch (error) {
      console.error('Error saving categories:', error);
      alert('Failed to save categories');
    }
    setSaving(false);
  };

  const refreshTransactions = async () => {
    if (!window.confirm('This will refresh all transactions with corrected income/expense categorization. Continue?')) {
      return;
    }
    
    setLoading(true);
    try {
      const response = await api.post(`/api/clients/${client.clientId}/refresh-transactions`, {
        month: selectedMonth
      });
      
      if (response.data.success) {
        // Reload the transactions
        await loadTransactions();
        alert('Transactions refreshed with corrected categorization!');
      } else {
        alert(response.data.message || 'No valid bank connections found. Please connect a real bank account.');
      }
    } catch (error) {
      console.error('Error refreshing transactions:', error);
      alert('Failed to refresh transactions. Make sure you have a valid bank connection.');
    }
    setLoading(false);
  };

  const markAllAsReviewed = async () => {
    // Update local state
    setTransactions(prev => prev.map(t => ({ 
      ...t, 
      isReviewed: true,
      userCategory: t.userCategory || t.finalCategory || t.suggestedCategory // Ensure category is set
    })));
    
    // Save to database
    try {
      const updatedTransactions = transactions.map(t => ({
        transactionId: t._id || t.plaidTransactionId,
        userCategory: t.userCategory || t.finalCategory || t.suggestedCategory,
        isReviewed: true
      }));

      await api.post(`/api/clients/${client.clientId}/update-transaction-categories`, {
        transactions: updatedTransactions,
        month: selectedMonth
      });
      
      // Reload to confirm
      await loadTransactions();
      alert('All transactions marked as reviewed!');
    } catch (error) {
      console.error('Error marking all as reviewed:', error);
      alert('Failed to mark all as reviewed');
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Math.abs(amount) || 0);
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
  // Negative amount = Inflow (Income)
  // Positive amount = Outflow (Expense)
  const isTransactionIncome = (transaction) => {
    const name = (transaction.name || transaction.merchantName || '').toLowerCase();
    const amount = transaction.amount;

    // First, check if it's a transfer, which is neither income nor expense.
    if (isTransactionTransfer(transaction)) {
      return null; // Return null to indicate it's a transfer
    }

    // Handle Zelle transactions explicitly.
    // A negative amount from Zelle is an inflow (income).
    if (name.includes('zelle') && amount < 0) {
      return true; // Explicitly income
    }

    // Apply the standard Plaid logic for all other transactions.
    // A negative amount represents an inflow of money (income).
    // A positive amount represents an outflow of money (expense).
    return amount < 0;
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
          
          <div>
            <label>Filter: </label>
            <select 
              value={filter} 
              onChange={(e) => setFilter(e.target.value)}
              style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
            >
              <option value="all">All Transactions ({transactions.length})</option>
              <option value="unreviewed">Unreviewed ({unreviewedCount})</option>
              <option value="reviewed">Reviewed ({transactions.length - unreviewedCount})</option>
            </select>
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
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              onClick={markAllAsReviewed}
              style={{
                padding: '8px 16px',
                background: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Mark All as Reviewed
            </button>
            
            <button 
              onClick={refreshTransactions}
              style={{
                padding: '8px 16px',
                background: '#ff6b35',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Fix Income/Expense
            </button>
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
                    const isIncome = isTransactionIncome(transaction);
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
                
                <div style={{ flex: '1', minWidth: '200px' }}>
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
                      const isTransfer = isTransactionTransfer(transaction);
                      const isIncome = isTransactionIncome(transaction);
                      
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