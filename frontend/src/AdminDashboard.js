import React, { useState, useEffect } from 'react';
import api from './api';
import DocumentReview from './components/DocumentReview';

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
  { value: 'uncategorized', label: 'Uncategorized' }
];

function AdminDashboard() {
  const [clients, setClients] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [view, setView] = useState('overview'); // 'overview', 'transactions', 'summaries', 'documents'
  const [monthlySummaries, setMonthlySummaries] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState('all');
  const [bulkUpdateMode, setBulkUpdateMode] = useState(false);
  const [selectedTransactions, setSelectedTransactions] = useState([]);

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const response = await api.get(`/api/admin/clients`);
      setClients(response.data.clients || []);
    } catch (error) {
      console.error('Error loading clients:', error);
      alert('Failed to load clients');
    }
  };

  const loadTransactions = async (clientId) => {
    setLoading(true);
    try {
      const response = await api.get(
        `/api/admin/transactions/${clientId}?month=${selectedMonth}`
      );
      setTransactions(response.data.transactions.map(t => ({
        ...t,
        finalCategory: t.userCategory || t.suggestedCategory,
        selected: false
      })));
      setSelectedClient(response.data.client);
      setView('transactions');
    } catch (error) {
      console.error('Error loading transactions:', error);
      alert('Error loading transactions');
    }
    setLoading(false);
  };

  const loadMonthlySummaries = async (clientId) => {
    setLoading(true);
    try {
      const response = await api.get(`/api/admin/summaries/${clientId}`);
      setMonthlySummaries(response.data.summaries || []);
      setSelectedClient(response.data.client);
      setView('summaries');
    } catch (error) {
      console.error('Error loading summaries:', error);
      alert('Error loading summaries');
    }
    setLoading(false);
  };

  const loadDocuments = async (clientId) => {
    setLoading(true);
    try {
      const client = clients.find(c => c.clientId === clientId);
      setSelectedClient(client);
      setView('documents');
    } catch (error) {
      console.error('Error loading documents:', error);
      alert('Error loading documents');
    }
    setLoading(false);
  };

  const updateTransactionCategory = (transactionId, category) => {
    setTransactions(prev => prev.map(t => 
      t._id === transactionId ? { ...t, finalCategory: category, isReviewed: true } : t
    ));
  };

  const toggleTransactionSelection = (transactionId) => {
    setTransactions(prev => prev.map(t => 
      t._id === transactionId ? { ...t, selected: !t.selected } : t
    ));
    
    setSelectedTransactions(prev => {
      if (prev.includes(transactionId)) {
        return prev.filter(id => id !== transactionId);
      } else {
        return [...prev, transactionId];
      }
    });
  };

  const bulkUpdateCategory = (category) => {
    setTransactions(prev => prev.map(t => 
      selectedTransactions.includes(t._id) 
        ? { ...t, finalCategory: category, isReviewed: true }
        : t
    ));
    setSelectedTransactions([]);
    setBulkUpdateMode(false);
  };

  const saveCategories = async () => {
    if (!selectedClient) return;
    
    setLoading(true);
    try {
      const updatedTransactions = transactions.map(t => ({
        transactionId: t._id,
        userCategory: t.finalCategory,
        isReviewed: t.isReviewed
      }));

      await api.post(`/api/admin/save-categories/${selectedClient.clientId}`, {
        transactions: updatedTransactions,
        month: selectedMonth
      });
      
      alert('Categories saved successfully!');
      
      // Optionally regenerate summary
      if (window.confirm('Would you like to regenerate the monthly summary with updated categories?')) {
        await regenerateSummary();
      }
    } catch (error) {
      console.error('Error saving categories:', error);
      alert('Failed to save categories');
    }
    setLoading(false);
  };

  const regenerateSummary = async () => {
    if (!selectedClient) return;
    
    try {
      await api.post(`/api/admin/regenerate-summary/${selectedClient.clientId}`, {
        month: selectedMonth
      });
      alert('Monthly summary regenerated successfully!');
    } catch (error) {
      console.error('Error regenerating summary:', error);
      alert('Failed to regenerate summary');
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  // Filter transactions
  const filteredTransactions = transactions.filter(transaction => {
    const matchesFilter = filter === 'all' || 
      (filter === 'unreviewed' && !transaction.isReviewed) ||
      (filter === 'reviewed' && transaction.isReviewed) ||
      (filter === 'income' && transaction.amount > 0) ||
      (filter === 'expense' && transaction.amount < 0);
    
    const matchesSearch = searchTerm === '' || 
      (transaction.name && transaction.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (transaction.merchantName && transaction.merchantName.toLowerCase().includes(searchTerm.toLowerCase()));
    
    return matchesFilter && matchesSearch;
  });

  const unreviewedCount = transactions.filter(t => !t.isReviewed).length;

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Header */}
      <div style={{
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(10px)',
        padding: '20px',
        color: 'white',
        textAlign: 'center'
      }}>
        <h1 style={{ margin: '0 0 10px 0', fontSize: '2rem' }}>
          Administrator Dashboard
        </h1>
        <p style={{ margin: 0, opacity: 0.9 }}>
          Manage client accounts and transaction categorization
        </p>
      </div>

      <div style={{ 
        maxWidth: '1400px', 
        margin: '0 auto', 
        padding: '20px',
        display: 'flex',
        gap: '20px'
      }}>
        {/* Client Sidebar */}
        <div style={{ 
          flex: '0 0 300px',
          background: 'white',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
          height: 'fit-content'
        }}>
          <h3 style={{ margin: '0 0 20px 0', color: '#333' }}>
            Clients ({clients.length})
          </h3>
          
          <div style={{ marginBottom: '15px' }}>
            <input
              type="text"
              placeholder="Search clients..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {clients
              .filter(client => 
                client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                client.email.toLowerCase().includes(searchTerm.toLowerCase())
              )
              .map(client => (
                <div
                  key={client.clientId}
                  style={{
                    padding: '12px',
                    cursor: 'pointer',
                    backgroundColor: selectedClient?.clientId === client.clientId 
                      ? '#e3f2fd' 
                      : '#f9f9f9',
                    marginBottom: '8px',
                    border: '1px solid #ddd',
                    borderRadius: '6px',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#e8f4fd'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 
                    selectedClient?.clientId === client.clientId ? '#e3f2fd' : '#f9f9f9'}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div>
                      <strong style={{ fontSize: '14px' }}>{client.name}</strong>
                      <div style={{ fontSize: '12px', color: '#666' }}>{client.email}</div>
                      <div style={{ fontSize: '11px', color: '#999' }}>
                        {client.plaidAccessTokens?.length || 0} bank(s) connected
                      </div>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        loadTransactions(client.clientId);
                      }}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        background: '#667eea',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      Transactions
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        loadMonthlySummaries(client.clientId);
                      }}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        background: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      Summaries
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        loadDocuments(client.clientId);
                      }}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        background: '#ff6b35',
                        color: 'white',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                      }}
                    >
                      Documents
                    </button>
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* Main Content */}
        <div style={{ 
          flex: '1',
          background: 'white',
          borderRadius: '12px',
          padding: '30px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)'
        }}>
          {view === 'overview' && (
            <div style={{ textAlign: 'center', padding: '60px 30px' }}>
              <h3 style={{ margin: '0 0 15px 0', color: '#333', fontSize: '1.5rem' }}>
                Administrator Panel
              </h3>
              <p style={{ margin: 0, color: '#666', fontSize: '1.1rem' }}>
                Select a client from the sidebar to view their transactions or monthly summaries.
              </p>
            </div>
          )}

          {view === 'transactions' && selectedClient && (
            <>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '20px'
              }}>
                <h3 style={{ margin: 0, color: '#333' }}>
                  Transactions for {selectedClient.name} - {selectedMonth}
                </h3>
                <button
                  onClick={() => setView('overview')}
                  style={{
                    padding: '8px 16px',
                    background: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Back to Overview
                </button>
              </div>

              {/* Controls */}
              <div style={{ 
                display: 'flex', 
                gap: '15px', 
                marginBottom: '20px', 
                flexWrap: 'wrap',
                alignItems: 'center'
              }}>
                <div>
                  <label>Month: </label>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
                  />
                  <button
                    onClick={() => loadTransactions(selectedClient.clientId)}
                    style={{
                      marginLeft: '8px',
                      padding: '6px 12px',
                      background: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    Load
                  </button>
                </div>
                
                <div>
                  <label>Filter: </label>
                  <select 
                    value={filter} 
                    onChange={(e) => setFilter(e.target.value)}
                    style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
                  >
                    <option value="all">All ({transactions.length})</option>
                    <option value="unreviewed">Unreviewed ({unreviewedCount})</option>
                    <option value="reviewed">Reviewed ({transactions.length - unreviewedCount})</option>
                    <option value="income">Income</option>
                    <option value="expense">Expenses</option>
                  </select>
                </div>

                <div>
                  <button
                    onClick={() => setBulkUpdateMode(!bulkUpdateMode)}
                    style={{
                      padding: '6px 12px',
                      background: bulkUpdateMode ? '#dc3545' : '#667eea',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  >
                    {bulkUpdateMode ? 'Cancel Bulk' : 'Bulk Update'}
                  </button>
                </div>
              </div>

              {/* Bulk Update Panel */}
              {bulkUpdateMode && selectedTransactions.length > 0 && (
                <div style={{
                  background: '#f8f9fa',
                  padding: '15px',
                  borderRadius: '8px',
                  marginBottom: '20px',
                  border: '1px solid #dee2e6'
                }}>
                  <div style={{ marginBottom: '10px' }}>
                    <strong>Bulk Update {selectedTransactions.length} selected transactions:</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <select 
                      onChange={(e) => {
                        if (e.target.value) {
                          bulkUpdateCategory(e.target.value);
                        }
                      }}
                      style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                      defaultValue=""
                    >
                      <option value="">Select category...</option>
                      {EXPENSE_CATEGORIES.map(cat => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                      <option value="income">Income</option>
                    </select>
                    <button
                      onClick={() => {
                        setSelectedTransactions([]);
                        setBulkUpdateMode(false);
                      }}
                      style={{
                        padding: '6px 12px',
                        background: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              )}

              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <p>Loading transactions...</p>
                </div>
              ) : (
                <>
                  <div style={{ marginBottom: '15px' }}>
                    <strong>Showing {filteredTransactions.length} of {transactions.length} transactions</strong>
                    {unreviewedCount > 0 && (
                      <span style={{ color: '#ff6b35', marginLeft: '15px' }}>
                        {unreviewedCount} unreviewed
                      </span>
                    )}
                  </div>
                  
                  <div style={{ 
                    maxHeight: '600px', 
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
                            padding: '12px', 
                            borderBottom: '1px solid #eee',
                            display: 'flex',
                            alignItems: 'center',
                            backgroundColor: transaction.selected ? '#e8f4fd' : 
                              (transaction.isReviewed ? '#f8f9fa' : '#fff')
                          }}
                        >
                          {bulkUpdateMode && (
                            <div style={{ marginRight: '15px' }}>
                              <input
                                type="checkbox"
                                checked={transaction.selected || false}
                                onChange={() => toggleTransactionSelection(transaction._id)}
                                style={{ transform: 'scale(1.2)' }}
                              />
                            </div>
                          )}
                          
                          <div style={{ flex: '2' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
                              {transaction.merchantName || transaction.name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>
                              {new Date(transaction.date).toLocaleDateString()} | {transaction.accountId}
                            </div>
                            {transaction.category && transaction.category.length > 0 && (
                              <div style={{ fontSize: '11px', color: '#999', marginTop: '1px' }}>
                                Original: {transaction.category.join(' → ')}
                              </div>
                            )}
                          </div>
                          
                          <div style={{ 
                            flex: '0 0 100px', 
                            textAlign: 'right',
                            marginRight: '15px'
                          }}>
                            <div style={{ 
                              fontWeight: 'bold', 
                              fontSize: '14px',
                              color: transaction.amount > 0 ? '#28a745' : '#dc3545'
                            }}>
                              {formatCurrency(Math.abs(transaction.amount))}
                            </div>
                            {transaction.amount > 0 && (
                              <div style={{ fontSize: '10px', color: '#28a745' }}>Income</div>
                            )}
                          </div>
                          
                          <div style={{ flex: '0 0 180px' }}>
                            <select
                              value={transaction.finalCategory}
                              onChange={(e) => updateTransactionCategory(transaction._id, e.target.value)}
                              style={{ 
                                width: '100%', 
                                padding: '6px',
                                borderRadius: '4px',
                                border: '1px solid #ccc',
                                fontSize: '12px',
                                backgroundColor: transaction.isReviewed ? '#e8f5e8' : '#fff'
                              }}
                              disabled={bulkUpdateMode}
                            >
                              {transaction.amount > 0 ? (
                                <option value="income">Income</option>
                              ) : (
                                EXPENSE_CATEGORIES.map(cat => (
                                  <option key={cat.value} value={cat.value}>
                                    {cat.label}
                                  </option>
                                ))
                              )}
                            </select>
                            
                            {transaction.isReviewed && (
                              <div style={{ 
                                fontSize: '10px', 
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
                  
                  <div style={{ marginTop: '20px', display: 'flex', gap: '15px', justifyContent: 'center' }}>
                    <button 
                      onClick={saveCategories} 
                      disabled={loading}
                      style={{ 
                        padding: '12px 24px', 
                        backgroundColor: loading ? '#ccc' : '#667eea', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                      }}
                    >
                      {loading ? 'Saving...' : 'Save All Categories'}
                    </button>
                    
                    <button 
                      onClick={regenerateSummary}
                      style={{ 
                        padding: '12px 24px', 
                        backgroundColor: '#28a745', 
                        color: 'white', 
                        border: 'none', 
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                      }}
                    >
                      Regenerate Summary
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {view === 'summaries' && selectedClient && (
            <>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: '20px'
              }}>
                <h3 style={{ margin: 0, color: '#333' }}>
                  Monthly Summaries for {selectedClient.name}
                </h3>
                <button
                  onClick={() => setView('overview')}
                  style={{
                    padding: '8px 16px',
                    background: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Back to Overview
                </button>
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <p>Loading summaries...</p>
                </div>
              ) : monthlySummaries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                  No monthly summaries found for this client.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: '20px' }}>
                  {monthlySummaries.map(summary => (
                    <div 
                      key={summary._id}
                      style={{
                        border: '1px solid #e1e5e9',
                        borderRadius: '8px',
                        padding: '20px',
                        background: '#f8f9fc'
                      }}
                    >
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        marginBottom: '15px'
                      }}>
                        <h4 style={{ margin: 0, color: '#333' }}>
                          {summary.monthYear}
                        </h4>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          {summary.transactionsProcessed} transactions | 
                          Status: <span style={{ 
                            color: summary.reviewStatus === 'approved' ? '#28a745' : '#ffc107'
                          }}>
                            {summary.reviewStatus}
                          </span>
                        </div>
                      </div>
                      
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                        gap: '15px'
                      }}>
                        <div>
                          <strong>Cash Flow</strong>
                          <div>Income: {formatCurrency(summary.cashFlow?.income || 0)}</div>
                          <div>Expenses: {formatCurrency(summary.cashFlow?.totalExpenses || 0)}</div>
                          <div style={{ 
                            color: (summary.cashFlow?.difference || 0) >= 0 ? '#28a745' : '#dc3545'
                          }}>
                            Net: {formatCurrency(summary.cashFlow?.difference || 0)}
                          </div>
                        </div>
                        
                        <div>
                          <strong>Net Worth</strong>
                          <div>Assets: {formatCurrency(summary.netWorth?.assets || 0)}</div>
                          <div>Liabilities: {formatCurrency(summary.netWorth?.liabilities || 0)}</div>
                          <div style={{ 
                            color: (summary.netWorth?.netWorth || 0) >= 0 ? '#28a745' : '#dc3545'
                          }}>
                            Net Worth: {formatCurrency(summary.netWorth?.netWorth || 0)}
                          </div>
                        </div>
                        
                        <div>
                          <strong>Savings</strong>
                          <div>
                            Rate: {((summary.clientProfile?.savingsRate || 0)).toFixed(1)}%
                          </div>
                          <div style={{ fontSize: '11px', color: '#666', marginTop: '5px' }}>
                            Last updated: {new Date(summary.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      
                      <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
                        <button
                          onClick={() => {
                            setSelectedMonth(summary.monthYear);
                            loadTransactions(selectedClient.clientId);
                          }}
                          style={{
                            padding: '6px 12px',
                            background: '#667eea',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          View Transactions
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {view === 'documents' && selectedClient && (
            <DocumentReview selectedClient={selectedClient} />
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminDashboard;