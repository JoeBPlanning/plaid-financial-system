import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { usePlaidLink } from 'react-plaid-link';
import { Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import './App.css';
import AdminDashboard from './AdminDashboard';
import TransactionReview from './TransactionReview';
import StatementUpload from './components/StatementUpload';
import {
  supabase,
  signUp,
  signIn,
  signOut,
  getSession,
  resetPassword,
  updatePassword,
  onAuthStateChange,
  validatePassword,
  validateEmail
} from './supabaseClient';
import config from './config';

// Register Chart.js components
ChartJS.register(ArcElement, Tooltip, Legend);

// Configure axios to include Supabase auth token
const axiosInstance = axios.create({
  baseURL: config.API_BASE,
  withCredentials: true,
});

// Add Supabase auth token to all requests
axiosInstance.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

// Handle authentication errors
axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 403 || error.response?.status === 401) {
      // Log the error for debugging
      console.error('Auth error from backend:', error.response?.data || error.message);
      console.error('Failed URL:', error.config?.url);

      // Only sign out for actual auth failures, not missing data
      if (!error.config?.url?.includes('/summaries') &&
          !error.config?.url?.includes('/transactions') &&
          !error.config?.url?.includes('/investments') &&
          !error.config?.url?.includes('/process-transactions')) {
        await signOut();
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

function App() {
  const [step, setStep] = useState('login');
  const [authMode, setAuthMode] = useState('login'); // 'login', 'register', 'forgot-password'
  // eslint-disable-next-line no-unused-vars
  const [user, setUser] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [session, setSession] = useState(null);
  const [client, setClient] = useState(null);
  const [linkToken, setLinkToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [currentNetWorth, setCurrentNetWorth] = useState(null);
  const [investments, setInvestments] = useState(null);
  const [investmentTaxFilter, setInvestmentTaxFilter] = useState('All Investments');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isPasswordReset, setIsPasswordReset] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showInactivityWarning, setShowInactivityWarning] = useState(false);

  // Auth form state
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    firstName: '',
    lastName: ''
  });
  const [authError, setAuthError] = useState('');
  const [authSuccess, setAuthSuccess] = useState('');
  const [passwordStrength, setPasswordStrength] = useState({ isValid: false, errors: [] });

  // Plaid Link configuration
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token, metadata) => {
      console.log('Plaid connection successful!', metadata);
      handlePlaidSuccess(public_token, metadata);
    },
    onExit: (err, metadata) => {
      console.log('Plaid connection exited', err, metadata);
      setStep('dashboard');
    },
    onEvent: (eventName, metadata) => {
      console.log('Plaid event:', eventName, metadata);
    },
  });

  // Auto-logout after 15 minutes of inactivity with 1-minute warning
  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    if (!user || !session) {
      setShowInactivityWarning(false);
      return;
    }

    const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes
    const WARNING_TIME = 14 * 60 * 1000; // 14 minutes (1 minute before logout)
    let inactivityTimer;
    let warningTimer;

    const resetTimer = () => {
      // Clear existing timers
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
      }
      if (warningTimer) {
        clearTimeout(warningTimer);
      }

      // Hide warning if user becomes active
      setShowInactivityWarning(false);

      // Set warning timer (14 minutes)
      warningTimer = setTimeout(() => {
        setShowInactivityWarning(true);
      }, WARNING_TIME);

      // Set logout timer (15 minutes)
      inactivityTimer = setTimeout(async () => {
        console.log('Auto-logout due to inactivity (15 minutes)');
        setShowInactivityWarning(false);
        try {
          await signOut();
          setUser(null);
          setSession(null);
          setClient(null);
          setStep('login');
          setAuthMode('login');
        } catch (error) {
          console.error('Auto-logout error:', error);
        }
      }, INACTIVITY_TIMEOUT);
    };

    // Activity events that reset the timer
    const activityEvents = [
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click'
    ];

    // Add event listeners
    activityEvents.forEach(event => {
      window.addEventListener(event, resetTimer, true);
    });

    // Initialize timer
    resetTimer();

    // Cleanup
    return () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
      }
      if (warningTimer) {
        clearTimeout(warningTimer);
      }
      activityEvents.forEach(event => {
        window.removeEventListener(event, resetTimer, true);
      });
      setShowInactivityWarning(false);
    };
  }, [user, session]);

  // Check session on mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        // Check if this is a password reset flow
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const type = hashParams.get('type');

        if (type === 'recovery' && accessToken) {
          // User clicked password reset link
          setIsPasswordReset(true);
          setStep('login');
          setAuthLoading(false);
          return;
        }

        const { data: { session } } = await getSession();
        if (session) {
          setSession(session);
          setUser(session.user);
          // Create client object from session
          const clientData = {
            clientId: session.user.id,
            name: session.user.user_metadata?.name || session.user.email,
            email: session.user.email
          };
          setClient(clientData);
          setStep('dashboard');
          // Load dashboard data (disabled temporarily for debugging)
          console.log('Session restored - skipping data load');
          // await loadMonthlySummary(session.user.id, selectedMonth);
          // await checkUnreviewedTransactions(session.user.id);
          // await loadInvestments(session.user.id);
        }
      } catch (error) {
        console.error('Session check error:', error);
      } finally {
        setAuthLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes
    const { data: authListener } = onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event);
      if (event === 'SIGNED_IN' && session) {
        setSession(session);
        setUser(session.user);
        const clientData = {
          clientId: session.user.id,
          name: session.user.user_metadata?.name || session.user.email,
          email: session.user.email
        };
        setClient(clientData);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setClient(null);
        setStep('login');
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // Watch password for strength validation
  useEffect(() => {
    if (authForm.password) {
      const strength = validatePassword(authForm.password);
      setPasswordStrength(strength);
    } else {
      setPasswordStrength({ isValid: false, errors: [] });
    }
  }, [authForm.password]);

  // Handle registration
  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    setLoading(true);

    try {
      // Validate inputs
      if (!authForm.firstName || !authForm.lastName || !authForm.email || !authForm.password || !authForm.confirmPassword) {
        setAuthError('All fields are required');
        setLoading(false);
        return;
      }

      if (!validateEmail(authForm.email)) {
        setAuthError('Please enter a valid email address');
        setLoading(false);
        return;
      }

      if (!passwordStrength.isValid) {
        setAuthError(passwordStrength.errors.join('. '));
        setLoading(false);
        return;
      }

      if (authForm.password !== authForm.confirmPassword) {
        setAuthError('Passwords do not match');
        setLoading(false);
        return;
      }

      const fullName = `${authForm.firstName} ${authForm.lastName}`.trim();
      const { error } = await signUp(authForm.email, authForm.password, fullName);

      if (error) {
        if (error.message.includes('already registered')) {
          setAuthError('This email is already registered. Please login instead.');
        } else {
          setAuthError(error.message);
        }
        setLoading(false);
        return;
      }

      setAuthSuccess('Registration successful! Please check your email to verify your account.');
      setAuthForm({ email: '', password: '', confirmPassword: '', firstName: '', lastName: '' });

      // Switch to login mode after 3 seconds
      setTimeout(() => {
        setAuthMode('login');
        setAuthSuccess('');
      }, 3000);

    } catch (error) {
      console.error('Registration error:', error);
      setAuthError('Registration failed. Please try again.');
    }
    setLoading(false);
  };

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    setLoading(true);

    try {
      if (!authForm.email || !authForm.password) {
        setAuthError('Email and password are required');
        setLoading(false);
        return;
      }

      if (!validateEmail(authForm.email)) {
        setAuthError('Please enter a valid email address');
        setLoading(false);
        return;
      }

      const { data, error } = await signIn(authForm.email, authForm.password);

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setAuthError('Invalid email or password');
        } else if (error.message.includes('Email not confirmed')) {
          setAuthError('Please verify your email first. Check your inbox for the verification link.');
        } else {
          setAuthError(error.message);
        }
        setLoading(false);
        return;
      }

      // Create client object
      const clientData = {
        clientId: data.user.id,
        name: data.user.user_metadata?.name || data.user.email,
        email: data.user.email
      };

      setUser(data.user);
      setSession(data.session);
      setClient(clientData);
      setStep('dashboard');

      // Load dashboard data (disabled temporarily for debugging)
      // TODO: Re-enable once backend is properly configured
      console.log('Skipping data load - user logged in successfully');
      // await loadMonthlySummary(data.user.id, selectedMonth);
      // await checkUnreviewedTransactions(data.user.id);
      // await loadInvestments(data.user.id);

    } catch (error) {
      console.error('Login error:', error);
      setAuthError('Login failed. Please try again.');
    }
    setLoading(false);
  };

  // Handle forgot password
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    setLoading(true);

    try {
      if (!authForm.email) {
        setAuthError('Email is required');
        setLoading(false);
        return;
      }

      if (!validateEmail(authForm.email)) {
        setAuthError('Please enter a valid email address');
        setLoading(false);
        return;
      }

      const { error } = await resetPassword(authForm.email);

      if (error) {
        setAuthError(error.message);
        setLoading(false);
        return;
      }

      setAuthSuccess('Password reset email sent! Please check your inbox.');
      setAuthForm({ email: '', password: '', confirmPassword: '', firstName: '', lastName: '' });

    } catch (error) {
      console.error('Password reset error:', error);
      setAuthError('Password reset failed. Please try again.');
    }
    setLoading(false);
  };

  // Handle password reset
  const handlePasswordReset = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthSuccess('');
    setLoading(true);

    try {
      if (!newPassword || !confirmNewPassword) {
        setAuthError('Both password fields are required');
        setLoading(false);
        return;
      }

      const strength = validatePassword(newPassword);
      if (!strength.isValid) {
        setAuthError(strength.errors.join('. '));
        setLoading(false);
        return;
      }

      if (newPassword !== confirmNewPassword) {
        setAuthError('Passwords do not match');
        setLoading(false);
        return;
      }

      const { error } = await updatePassword(newPassword);

      if (error) {
        setAuthError(error.message);
        setLoading(false);
        return;
      }

      setAuthSuccess('Password updated successfully! Redirecting to login...');
      setNewPassword('');
      setConfirmNewPassword('');
      setIsPasswordReset(false);

      // Redirect to login after 2 seconds
      setTimeout(() => {
        window.location.hash = '';
        window.location.reload();
      }, 2000);

    } catch (error) {
      console.error('Password reset error:', error);
      setAuthError('Password reset failed. Please try again.');
    }
    setLoading(false);
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await signOut();
      setUser(null);
      setSession(null);
      setClient(null);
      setStep('login');
      setAuthMode('login');
      setAuthForm({ email: '', password: '', confirmPassword: '', firstName: '', lastName: '' });
      setMonthlySummary(null);
      setInvestments(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Load monthly summary for client
  const loadMonthlySummary = async (clientId, month = null) => {
    const targetMonth = month || selectedMonth;
    try {
      // Try to get summary for specific month
      const response = await axiosInstance.get(`/api/clients/${clientId}/summaries?limit=12`);
      if (response.data.summaries && response.data.summaries.length > 0) {
        // Find summary for the target month
        const monthSummary = response.data.summaries.find(s => s.monthYear === targetMonth);
        if (monthSummary) {
          setMonthlySummary(monthSummary);
          return;
        }
        // If not found, use the most recent one
        setMonthlySummary(response.data.summaries[0]);
        return;
      }
      
      // If no summary exists, generate one using process-transactions
      try {
        const processResponse = await axiosInstance.post(`/api/process-transactions/${clientId}`, {
          targetMonth: targetMonth,
          useUserCategories: true
        });
        if (processResponse.data.summary) {
          setMonthlySummary(processResponse.data.summary);
        } else {
          // Fallback: try regenerate-summary endpoint
          const genResponse = await axiosInstance.post(`/api/admin/regenerate-summary/${clientId}`, {
            month: targetMonth
          });
          if (genResponse.data.success && genResponse.data.summary) {
            setMonthlySummary(genResponse.data.summary);
          } else {
            // Last resort: reload summaries
            const reloadResponse = await axiosInstance.get(`/api/clients/${clientId}/summaries?limit=1`);
            if (reloadResponse.data.summaries && reloadResponse.data.summaries.length > 0) {
              setMonthlySummary(reloadResponse.data.summaries[0]);
            }
          }
        }
      } catch (genError) {
        console.error('Could not generate summary:', genError);
        // Try to load any existing summary as last resort
        const fallbackResponse = await axiosInstance.get(`/api/clients/${clientId}/summaries?limit=1`);
        if (fallbackResponse.data.summaries && fallbackResponse.data.summaries.length > 0) {
          setMonthlySummary(fallbackResponse.data.summaries[0]);
        }
      }
    } catch (error) {
      console.error('Error loading monthly summary:', error);
      // Try to process transactions as a last resort
      try {
        const processResponse = await axiosInstance.post(`/api/process-transactions/${clientId}`, {
          targetMonth: targetMonth,
          useUserCategories: true
        });
        if (processResponse.data.summary) {
          setMonthlySummary(processResponse.data.summary);
        }
      } catch (processError) {
        console.error('Could not process transactions:', processError);
      }
    }
  };

  // Load current net worth (always up-to-date)
  const loadCurrentNetWorth = async (clientId) => {
    try {
      // Process transactions for current month to get latest net worth
      const currentMonth = new Date().toISOString().slice(0, 7);
      const processResponse = await axiosInstance.post(`/api/process-transactions/${clientId}`, {
        targetMonth: currentMonth,
        useUserCategories: true
      });
      if (processResponse.data.summary && processResponse.data.summary.netWorth) {
        setCurrentNetWorth(processResponse.data.summary.netWorth);
      }
    } catch (error) {
      console.error('Error loading current net worth:', error);
    }
  };

  // Load current net worth and investments when client changes
  useEffect(() => {
    if (client && step === 'dashboard') {
      loadCurrentNetWorth(client.clientId);
      loadInvestments(client.clientId);
    }
  }, [client, step]);

  // Load investments for client
  const loadInvestments = async (clientId) => {
    try {
      const response = await axiosInstance.get(`/api/clients/${clientId}/investments`);
      if (response.data.success) {
        console.log('Investments loaded:', response.data);
        setInvestments(response.data);
      }
    } catch (error) {
      console.error('Error loading investments:', error);
      // Don't show error if investments endpoint doesn't exist or no investments
      if (error.response?.status !== 404) {
        console.error('Could not load investments:', error);
      }
    }
  };

  // Check for unreviewed transactions
  const checkUnreviewedTransactions = async (clientId) => {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const response = await axiosInstance.get(
        `/api/clients/${clientId}/transactions?month=${currentMonth}`
      );
      
      const unreviewed = response.data.transactions.filter(t => !t.isReviewed).length;
      setUnreviewedCount(unreviewed);
      
      // Auto-prompt for review if there are many unreviewed transactions
      if (unreviewed > 10) {
        setTimeout(() => {
          if (window.confirm(`You have ${unreviewed} unreviewed transactions. Would you like to review and categorize them now?`)) {
            setShowReview(true);
            setStep('review');
          }
        }, 2000);
      }
    } catch (error) {
      console.log('Error checking unreviewed transactions:', error);
    }
  };

  // Start bank connection process
  const connectBank = async () => {
    setLoading(true);
    try {
      // clientId is now derived from authenticated session cookie
      const response = await axiosInstance.post(`/api/create_link_token`);
      
      setLinkToken(response.data.link_token);
      setStep('connecting');
    } catch (error) {
      console.error('Error creating link token:', error);
      alert('Failed to start bank connection. Please try again.');
    }
    setLoading(false);
  };

  // Handle successful Plaid connection
  const handlePlaidSuccess = async (public_token, metadata) => {
    setLoading(true);
    try {
      // Exchange public token for access token
      // clientId is now derived from authenticated session cookie
      const exchangeResponse = await axiosInstance.post(`/api/exchange_public_token`, {
        public_token
      });

      // Add bank connection to client
      await axiosInstance.post(`/api/clients/${client.clientId}/plaid-token`, {
        accessToken: exchangeResponse.data.access_token,
        itemId: exchangeResponse.data.item_id,
        institutionName: exchangeResponse.data.institution_name,
        institutionId: exchangeResponse.data.institution_id,
        accountIds: exchangeResponse.data.account_ids
      });

      // Store transactions for review
      await axiosInstance.post(`/api/clients/${client.clientId}/store-transactions`);

      // Sync investments
      try {
        await axiosInstance.post(`/api/clients/${client.clientId}/sync-investments`);
      } catch (invError) {
        console.warn('Could not sync investments:', invError);
        // Don't fail the whole connection if investments fail
      }

      alert(`Successfully connected ${exchangeResponse.data.institution_name}! Please review and categorize your transactions.`);
      setShowReview(true);
      setStep('review');
      
    } catch (error) {
      console.error('Error handling Plaid success:', error);
      alert('Failed to complete bank connection. Please try again.');
    }
    setLoading(false);
  };

  // Process transactions for the client
  const processTransactions = async (useReviewedTransactions = false) => {
    try {
      const response = await axiosInstance.post(`/api/process-transactions/${client.clientId}`, {
        useUserCategories: useReviewedTransactions
      });
      setMonthlySummary(response.data.summary);
      return response.data.summary;
    } catch (error) {
      console.error('Error processing transactions:', error);
      throw error;
    }
  };

  // Trigger manual transaction processing
  const refreshData = async () => {
    setLoading(true);
    try {
      // Sync transactions
      await axiosInstance.post(`/api/clients/${client.clientId}/sync-transactions`);
      
      // Sync investments
      try {
        await axiosInstance.post(`/api/clients/${client.clientId}/sync-investments`);
      } catch (invError) {
        console.warn('Could not sync investments:', invError);
        // Don't fail the whole refresh if investments fail
      }
      
      // Process transactions to generate summary
      await processTransactions(true);
      
      // Reload monthly summary
      await loadMonthlySummary(client.clientId, selectedMonth);
      
      // Reload investments
      await loadInvestments(client.clientId);
      
      // Check for unreviewed transactions
      await checkUnreviewedTransactions(client.clientId);
      
      alert('Financial data refreshed successfully!');
    } catch (error) {
      console.error('Error refreshing data:', error);
      alert('Failed to refresh data. Please try again.');
    }
    setLoading(false);
  };

  // Open review interface
  const openTransactionReview = () => {
    setShowReview(true);
    setStep('review');
  };

  // Open Plaid Link when token is ready
  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  // Check if this is admin route
  if (window.location.pathname === '/admin') {
    return <AdminDashboard />;
  }

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  // Show loading screen while checking auth
  if (authLoading) {
    return (
      <div className="app">
        <div className="login-container">
          <h1>Financial Progress Portal</h1>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Login/Register/ForgotPassword Screen
  if (step === 'login') {
    return (
      <div className="app">
        <div className="login-container">
          <h1>Financial Progress Portal</h1>
          <p>Connect your bank accounts to get your monthly financial report</p>

          {/* Password Reset Form */}
          {isPasswordReset && (
            <form onSubmit={handlePasswordReset} className="login-form">
              <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#667eea' }}>Set New Password</h2>

              {authError && (
                <div className="auth-message error">{authError}</div>
              )}
              {authSuccess && (
                <div className="auth-message success">{authSuccess}</div>
              )}

              <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '20px' }}>
                Enter your new password below.
              </p>

              <div className="password-input-container">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex="-1"
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>

              {newPassword && (
                <div className="password-strength">
                  {(() => {
                    const strength = validatePassword(newPassword);
                    return strength.isValid ? (
                      <div style={{ color: '#28a745' }}>✓ Strong password</div>
                    ) : (
                      <div style={{ color: '#dc3545', fontSize: '0.85em' }}>
                        {strength.errors.map((err, idx) => (
                          <div key={idx}>• {err}</div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="password-input-container">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm New Password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex="-1"
                >
                  {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>

              {newPassword && confirmNewPassword && newPassword !== confirmNewPassword && (
                <div className="password-match-error">Passwords do not match</div>
              )}

              <button type="submit" disabled={loading}>
                {loading ? 'Updating Password...' : 'Update Password'}
              </button>
            </form>
          )}

          {/* Registration Form */}
          {!isPasswordReset && authMode === 'register' && (
            <form onSubmit={handleRegister} className="login-form">
              <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#667eea' }}>Create Account</h2>

              {authError && (
                <div className="auth-message error">{authError}</div>
              )}
              {authSuccess && (
                <div className="auth-message success">{authSuccess}</div>
              )}

              <input
                type="text"
                placeholder="First Name"
                value={authForm.firstName}
                onChange={(e) => setAuthForm({...authForm, firstName: e.target.value})}
                required
              />

              <input
                type="text"
                placeholder="Last Name"
                value={authForm.lastName}
                onChange={(e) => setAuthForm({...authForm, lastName: e.target.value})}
                required
              />

              <input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                required
              />

              <div className="password-input-container">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={authForm.password}
                  onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex="-1"
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>

              {authForm.password && (
                <div className="password-strength">
                  {passwordStrength.isValid ? (
                    <div style={{ color: '#28a745' }}>✓ Strong password</div>
                  ) : (
                    <div style={{ color: '#dc3545', fontSize: '0.85em' }}>
                      {passwordStrength.errors.map((err, idx) => (
                        <div key={idx}>• {err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="password-input-container">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm Password"
                  value={authForm.confirmPassword}
                  onChange={(e) => setAuthForm({...authForm, confirmPassword: e.target.value})}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  tabIndex="-1"
                >
                  {showConfirmPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>

              {authForm.password && authForm.confirmPassword && authForm.password !== authForm.confirmPassword && (
                <div className="password-match-error">Passwords do not match</div>
              )}

              <button type="submit" disabled={loading || !passwordStrength.isValid}>
                {loading ? 'Creating Account...' : 'Sign Up'}
              </button>

              <div className="auth-toggle">
                Already have an account?{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError('');
                    setAuthSuccess('');
                  }}
                >
                  Login
                </button>
              </div>
            </form>
          )}

          {/* Login Form */}
          {!isPasswordReset && authMode === 'login' && (
            <form onSubmit={handleLogin} className="login-form">
              <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#667eea' }}>Login</h2>

              {authError && (
                <div className="auth-message error">{authError}</div>
              )}
              {authSuccess && (
                <div className="auth-message success">{authSuccess}</div>
              )}

              <input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                required
              />

              <div className="password-input-container">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  value={authForm.password}
                  onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex="-1"
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>

              <button type="submit" disabled={loading} style={{ marginBottom: '15px' }}>
                {loading ? 'Logging in...' : 'Login'}
              </button>

              <div className="forgot-password-link" style={{ textAlign: 'center', marginTop: '0' }}>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setAuthMode('forgot-password');
                    setAuthError('');
                    setAuthSuccess('');
                  }}
                >
                  Forgot password?
                </button>
              </div>

              <div className="auth-toggle">
                Don't have an account?{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setAuthMode('register');
                    setAuthError('');
                    setAuthSuccess('');
                  }}
                >
                  Sign up
                </button>
              </div>
            </form>
          )}

          {/* Forgot Password Form */}
          {!isPasswordReset && authMode === 'forgot-password' && (
            <form onSubmit={handleForgotPassword} className="login-form">
              <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#667eea' }}>Reset Password</h2>

              {authError && (
                <div className="auth-message error">{authError}</div>
              )}
              {authSuccess && (
                <div className="auth-message success">{authSuccess}</div>
              )}

              <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '20px' }}>
                Enter your email address and we'll send you a link to reset your password.
              </p>

              <input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
                required
              />

              <button type="submit" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              <div className="auth-toggle">
                Remember your password?{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError('');
                    setAuthSuccess('');
                  }}
                >
                  Login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Connecting Screen
  if (step === 'connecting') {
    return (
      <div className="app">
        <div className="connecting-container">
          <h2>Connecting Your Bank Account</h2>
          <p>Please complete the bank connection process in the popup window.</p>
          <button onClick={() => setStep('dashboard')}>Cancel</button>
        </div>
      </div>
    );
  }

  // Review Screen
  if (step === 'review' || showReview) {
    return (
      <div className="app">
        <header className="header">
          <h1>Review & Categorize Transactions</h1>
          <p>Ensure your transactions are properly categorized for accurate reporting</p>
        </header>
        <div className="dashboard">
          <TransactionReview 
            client={client}
            onComplete={() => {
              setShowReview(false);
              setStep('dashboard');
              processTransactions(true).then(() => {
                loadMonthlySummary(client.clientId);
                checkUnreviewedTransactions(client.clientId);
              });
            }}
          />
        </div>
      </div>
    );
  }

  // Dashboard Screen
  return (
    <div className="app">
      {/* Inactivity Warning Modal */}
      {showInactivityWarning && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '12px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
            textAlign: 'center'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '20px'
            }}>⏰</div>
            <h2 style={{
              margin: '0 0 15px 0',
              color: '#d32f2f',
              fontSize: '24px'
            }}>Session Timeout Warning</h2>
            <p style={{
              margin: '0 0 25px 0',
              color: '#666',
              fontSize: '16px',
              lineHeight: '1.5'
            }}>
              You've been inactive for 14 minutes. You will be automatically logged out in <strong>1 minute</strong> for security.
            </p>
            <button
              onClick={() => {
                setShowInactivityWarning(false);
                // Trigger activity to reset timer
                window.dispatchEvent(new Event('mousedown'));
              }}
              style={{
                backgroundColor: '#1976d2',
                color: 'white',
                border: 'none',
                padding: '12px 30px',
                borderRadius: '6px',
                fontSize: '16px',
                cursor: 'pointer',
                fontWeight: '600',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.target.style.backgroundColor = '#1565c0'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#1976d2'}
            >
              Stay Logged In
            </button>
          </div>
        </div>
      )}
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: '1200px', margin: '0 auto' }}>
          <div>
            <h1 style={{ margin: '0 0 10px 0' }}>Financial Progress Dashboard</h1>
            <p style={{ margin: '0' }}>Welcome, {client?.name}</p>
            {unreviewedCount > 0 && (
              <div style={{
                background: 'rgba(255, 107, 53, 0.9)',
                padding: '8px 16px',
                borderRadius: '20px',
                fontSize: '14px',
                marginTop: '10px',
                display: 'inline-block'
              }}>
                {unreviewedCount} transactions need review
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: '10px 20px',
              background: 'rgba(255, 255, 255, 0.2)',
              color: 'white',
              border: '2px solid white',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'white';
              e.target.style.color = '#667eea';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'rgba(255, 255, 255, 0.2)';
              e.target.style.color = 'white';
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <div className="dashboard">
        <div className="actions">
          <button onClick={connectBank} disabled={loading}>
            Connect Bank Account
          </button>
          
          <button 
            onClick={openTransactionReview}
            style={{
              backgroundColor: unreviewedCount > 0 ? '#ff6b35' : '#28a745'
            }}
          >
            Review Transactions
            {unreviewedCount > 0 && ` (${unreviewedCount})`}
          </button>
          
          <button onClick={refreshData} disabled={loading}>
            {loading ? 'Updating...' : 'Refresh Financial Data'}
          </button>
        </div>

        {monthlySummary ? (
          <div>
            {/* Financial Summary */}
            <div className="financial-summary">
              <h2>Monthly Financial Summary - {monthlySummary.monthYear}</h2>
              
              {/* Month Selector */}
              <div style={{ marginBottom: '20px', textAlign: 'center' }}>
                <label htmlFor="month-selector" style={{ marginRight: '10px', fontWeight: '500' }}>
                  Select Month:
                </label>
                <input
                  type="month"
                  id="month-selector"
                  value={selectedMonth}
                  onChange={async (e) => {
                    const newMonth = e.target.value;
                    setSelectedMonth(newMonth);
                    if (client) {
                      await loadMonthlySummary(client.clientId, newMonth);
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    fontSize: '16px',
                    border: '2px solid #e1e5e9',
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                />
              </div>
              
              <div className="summary-grid">
              <div className="summary-section">
                <h3>Expenses</h3>
                <div className="summary-items">
                  <div>Total Expenses: {formatCurrency(monthlySummary.cashFlow?.totalExpenses || 0)}</div>
                </div>
              </div>

              <div className="summary-section">
                <h3>Expenses</h3>
                <div className="summary-items">
                  <div>Housing: {formatCurrency(monthlySummary.cashFlow?.housing || 0)}</div>
                  <div>Auto & Transport: {formatCurrency(monthlySummary.cashFlow?.autoAndTransport || 0)}</div>
                  <div>Groceries: {formatCurrency(monthlySummary.cashFlow?.groceries || 0)}</div>
                  <div>Dining Out: {formatCurrency(monthlySummary.cashFlow?.diningOut || 0)}</div>
                  <div>Shopping: {formatCurrency(monthlySummary.cashFlow?.shopping || 0)}</div>
                  <div>Bills & Utilities: {formatCurrency(monthlySummary.cashFlow?.billAndUtilities || 0)}</div>
                  <div>Entertainment: {formatCurrency(monthlySummary.cashFlow?.entertainment || 0)}</div>
                  <div>Health & Fitness: {formatCurrency(monthlySummary.cashFlow?.healthAndFitness || 0)}</div>
                  <div>Travel: {formatCurrency(monthlySummary.cashFlow?.travel || 0)}</div>
                  <div>Insurance: {formatCurrency(monthlySummary.cashFlow?.insurance || 0)}</div>
                  <div>Loan Payment: {formatCurrency(monthlySummary.cashFlow?.loanPayment || 0)}</div>
                  <div>Charitable Giving: {formatCurrency(monthlySummary.cashFlow?.charitableGiving || 0)}</div>
                  <div>Fees & Charges: {formatCurrency(monthlySummary.cashFlow?.feeAndCharges || 0)}</div>
                  <div>Other: {formatCurrency(monthlySummary.cashFlow?.uncategorized || 0)}</div>
                </div>
              </div>

              <div className="summary-section">
                <h3>Net Worth</h3>
                <div className="summary-items">
                  {/* Use current net worth if available, otherwise fall back to monthly summary */}
                  {(() => {
                    const netWorth = currentNetWorth || monthlySummary.netWorth;
                    return (
                      <>
                        <div>Total Assets: {formatCurrency(netWorth?.assets || 0)}</div>
                        <div>Total Liabilities: {formatCurrency(netWorth?.liabilities || 0)}</div>
                        <div className="total" style={{
                          color: (netWorth?.netWorth || 0) >= 0 ? '#28a745' : '#dc3545'
                        }}>
                          Net Worth: {formatCurrency(netWorth?.netWorth || 0)}
                        </div>
                        
                        {/* Asset Breakdown */}
                        <div className="breakdown-section" style={{marginTop: '15px', fontSize: '0.9em', borderTop: '1px solid #e1e5e9', paddingTop: '10px'}}>
                          <strong style={{display: 'block', marginBottom: '10px'}}>Asset Breakdown:</strong>
                          <div className="breakdown-item" style={{paddingBottom: '8px'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between'}}>
                              <span>Checking:</span>
                              <span>{formatCurrency(netWorth?.assetBreakdown?.checking || 0)}</span>
                            </div>
                          </div>
                          <div className="breakdown-item" style={{paddingBottom: '8px'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between'}}>
                              <span>Savings:</span>
                              <span>{formatCurrency(netWorth?.assetBreakdown?.savings || 0)}</span>
                            </div>
                          </div>
                          <div className="breakdown-item" style={{paddingBottom: '8px'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between'}}>
                              <span>Investments:</span>
                              <span>{formatCurrency(netWorth?.assetBreakdown?.investments || 0)}</span>
                            </div>
                          </div>
                          <div className="breakdown-item" style={{paddingBottom: '8px'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between'}}>
                              <span>Real Estate:</span>
                              <span>{formatCurrency(netWorth?.assetBreakdown?.realEstate || 0)}</span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Liability Breakdown */}
                        {(netWorth?.liabilities || 0) > 0 && (
                          <div className="breakdown-section" style={{marginTop: '15px', fontSize: '0.9em', borderTop: '1px solid #e1e5e9', paddingTop: '10px'}}>
                            <strong style={{display: 'block', marginBottom: '10px'}}>Liability Breakdown:</strong>
                            <div className="breakdown-item" style={{paddingBottom: '8px'}}>
                              <div style={{display: 'flex', justifyContent: 'space-between'}}>
                                <span>Credit Cards:</span>
                                <span>{formatCurrency(netWorth?.liabilityBreakdown?.creditCards || 0)}</span>
                              </div>
                            </div>
                            <div className="breakdown-item" style={{paddingBottom: '8px'}}>
                              <div style={{display: 'flex', justifyContent: 'space-between'}}>
                                <span>Student Loans:</span>
                                <span>{formatCurrency(netWorth?.liabilityBreakdown?.studentLoans || 0)}</span>
                              </div>
                            </div>
                            <div className="breakdown-item" style={{paddingBottom: '8px'}}>
                              <div style={{display: 'flex', justifyContent: 'space-between'}}>
                                <span>Mortgage:</span>
                                <span>{formatCurrency(netWorth?.liabilityBreakdown?.mortgage || 0)}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
            
            <div className="summary-footer">
              <p>
                <strong>Data Quality:</strong> {monthlySummary.transactionsProcessed} transactions processed
                {unreviewedCount > 0 && (
                  <span style={{ color: '#ff6b35', marginLeft: '10px' }}>
                    | {unreviewedCount} transactions need review
                  </span>
                )}
              </p>
              <p>Last updated: {new Date(monthlySummary.lastProcessedAt || monthlySummary.updatedAt).toLocaleDateString()}</p>
              
              {unreviewedCount > 0 && (
                <div style={{ marginTop: '15px' }}>
                  <button 
                    onClick={openTransactionReview}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: '#ff6b35',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: '600'
                    }}
                  >
                    Review {unreviewedCount} Unreviewed Transactions
                  </button>
                </div>
              )}
            </div>
            </div>
            
            {/* Investment Allocation - Below Financial Summary */}
            {investments && investments.totalValue > 0 && investments.assetClassBreakdown && (
              <div className="financial-summary" style={{ marginTop: '30px' }}>
                <h2 style={{ marginTop: 0 }}>Investment Allocation</h2>
                
                {/* Tax Type Filter Dropdown */}
                <div style={{ marginBottom: '20px' }}>
                  <label htmlFor="tax-filter" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
                    Filter by Tax Type:
                  </label>
                  <select
                    id="tax-filter"
                    value={investmentTaxFilter}
                    onChange={(e) => setInvestmentTaxFilter(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px',
                      fontSize: '16px',
                      border: '2px solid #e1e5e9',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      backgroundColor: 'white'
                    }}
                  >
                    <option value="All Investments">All Investments</option>
                    <option value="Tax-Free">Tax-Free</option>
                    <option value="Tax-Deferred">Tax-Deferred</option>
                    <option value="Taxable">Taxable</option>
                  </select>
                </div>

                {/* Pie Chart */}
                {(() => {
                  // Filter asset class breakdown by tax type
                  let filteredBreakdown = investments.assetClassBreakdown || {};
                  let totalValue = investments.totalValue;
                  
                  if (investmentTaxFilter !== 'All Investments') {
                    const taxTypeKey = investmentTaxFilter.toLowerCase().replace(' ', '-');
                    const taxTypeValue = investments.totalByTaxType?.[taxTypeKey] || 0;
                    
                    // Calculate percentages for filtered accounts
                    if (taxTypeValue > 0 && investments.holdingsByAccount) {
                      const filteredAccounts = investments.holdingsByAccount.filter(
                        acc => acc.accountTaxType === taxTypeKey
                      );
                      
                      // Recalculate asset class breakdown for filtered accounts
                      filteredBreakdown = {
                        'US Equities': 0,
                        'International': 0,
                        'Emerging Markets': 0,
                        'Real Estate': 0,
                        'US Bonds': 0,
                        'International Bonds': 0,
                        'Cash': 0,
                        'Other': 0
                      };
                      
                      filteredAccounts.forEach(account => {
                        account.holdings.forEach(holding => {
                          // Use the asset class mapping from backend if available
                          // For now, use a simplified mapping based on security type
                          const securityType = (holding.securityType || '').toLowerCase();
                          const securityName = (holding.securityName || '').toLowerCase();
                          
                          let assetClass = 'Other';
                          if (securityType === 'cash' || securityType === 'money market') {
                            assetClass = 'Cash';
                          } else if (securityType === 'reit' || securityName.includes('reit')) {
                            assetClass = 'Real Estate';
                          } else if (securityType === 'bond') {
                            assetClass = securityName.includes('international') || securityName.includes('global') 
                              ? 'International Bonds' : 'US Bonds';
                          } else if (securityType === 'equity' || securityType === 'stock' || securityType === 'etf') {
                            if (securityName.includes('emerging market')) {
                              assetClass = 'Emerging Markets';
                            } else if (securityName.includes('international') || securityName.includes('global')) {
                              assetClass = 'International';
                            } else {
                              assetClass = 'US Equities';
                            }
                          }
                          
                          filteredBreakdown[assetClass] = (filteredBreakdown[assetClass] || 0) + holding.value;
                        });
                      });
                      
                      totalValue = taxTypeValue;
                    } else {
                      filteredBreakdown = {
                        'US Equities': 0,
                        'International': 0,
                        'Emerging Markets': 0,
                        'Real Estate': 0,
                        'US Bonds': 0,
                        'International Bonds': 0,
                        'Cash': 0,
                        'Other': 0
                      };
                      totalValue = 0;
                    }
                  }
                  
                  // Prepare chart data
                  const assetClasses = Object.keys(filteredBreakdown);
                  const values = assetClasses.map(cls => filteredBreakdown[cls] || 0);
                  const colors = [
                    '#4A90E2', // US Equities - Blue
                    '#50C878', // International - Green
                    '#FF6B6B', // Emerging Markets - Red
                    '#FFA500', // Real Estate - Orange
                    '#9B59B6', // US Bonds - Purple
                    '#3498DB', // International Bonds - Light Blue
                    '#F39C12', // Cash - Gold
                    '#95A5A6'  // Other - Gray
                  ];
                  
                  const chartData = {
                    labels: assetClasses.filter((_, idx) => values[idx] > 0),
                    datasets: [{
                      data: values.filter(v => v > 0),
                      backgroundColor: colors.slice(0, values.filter(v => v > 0).length),
                      borderWidth: 2,
                      borderColor: '#fff'
                    }]
                  };
                  
                  const chartOptions = {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                      legend: {
                        position: 'bottom',
                        labels: {
                          padding: 15,
                          font: {
                            size: 12
                          }
                        }
                      },
                      tooltip: {
                        callbacks: {
                          label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const percentage = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : 0;
                            return `${label}: ${formatCurrency(value)} (${percentage}%)`;
                          }
                        }
                      }
                    }
                  };
                  
                  return totalValue > 0 ? (
                    <div>
                      <div style={{ marginBottom: '15px', textAlign: 'center' }}>
                        <strong style={{ fontSize: '18px' }}>
                          {formatCurrency(totalValue)}
                        </strong>
                        {investmentTaxFilter !== 'All Investments' && (
                          <div style={{ fontSize: '0.9em', color: '#666', marginTop: '5px' }}>
                            {investmentTaxFilter} Accounts Only
                          </div>
                        )}
                      </div>
                      <div style={{ height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Pie data={chartData} options={chartOptions} />
                      </div>
                      
                      {/* Asset Class Breakdown List */}
                      <div style={{ marginTop: '20px', fontSize: '0.9em' }}>
                        <strong>Breakdown:</strong>
                        {assetClasses.map((assetClass, idx) => {
                          const value = filteredBreakdown[assetClass] || 0;
                          if (value === 0) return null;
                          const percentage = totalValue > 0 ? (value / totalValue * 100).toFixed(1) : 0;
                          return (
                            <div key={idx} style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              padding: '5px 0',
                              borderBottom: '1px solid #f0f0f0'
                            }}>
                              <span>{assetClass}:</span>
                              <span>
                                {formatCurrency(value)} ({percentage}%)
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                      No investments found for {investmentTaxFilter}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        ) : (
          <div className="no-data">
            <h3>No Financial Data Yet</h3>
            <p>Connect your bank account and review your transactions to start generating monthly financial reports.</p>
            <div style={{ marginTop: '20px' }}>
              <button 
                onClick={connectBank}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  marginRight: '15px'
                }}
              >
                Connect Your First Bank Account
              </button>
            </div>
          </div>
        )}

        {/* Investment Holdings Details Section (below main summary) */}
        {investments && investments.totalValue > 0 && investments.holdingsByAccount && (
          <div className="financial-summary" style={{ marginTop: '30px' }}>
            <h2>Investment Holdings</h2>
            
            {/* Summary by Tax Type */}
            <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
              <h3 style={{ marginTop: 0, marginBottom: '15px' }}>Total Investment Value: {formatCurrency(investments.totalValue)}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                <div>
                  <strong>Tax-Free:</strong> {formatCurrency(investments.totalByTaxType?.['tax-free'] || 0)}
                  <div style={{ fontSize: '0.9em', color: '#666' }}>
                    {investments.totalValue > 0 ? ((investments.totalByTaxType?.['tax-free'] || 0) / investments.totalValue * 100).toFixed(1) : 0}%
                  </div>
                </div>
                <div>
                  <strong>Tax-Deferred:</strong> {formatCurrency(investments.totalByTaxType?.['tax-deferred'] || 0)}
                  <div style={{ fontSize: '0.9em', color: '#666' }}>
                    {investments.totalValue > 0 ? ((investments.totalByTaxType?.['tax-deferred'] || 0) / investments.totalValue * 100).toFixed(1) : 0}%
                  </div>
                </div>
                <div>
                  <strong>Taxable:</strong> {formatCurrency(investments.totalByTaxType?.['taxable'] || 0)}
                  <div style={{ fontSize: '0.9em', color: '#666' }}>
                    {investments.totalValue > 0 ? ((investments.totalByTaxType?.['taxable'] || 0) / investments.totalValue * 100).toFixed(1) : 0}%
                  </div>
                </div>
              </div>
            </div>

            {/* Holdings by Account */}
            <div>
              <h3>Holdings by Account</h3>
              {investments.holdingsByAccount && investments.holdingsByAccount.map((account, idx) => (
                <div key={idx} style={{ marginBottom: '25px', padding: '15px', border: '1px solid #e1e5e9', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>
                      <strong>{account.accountName}</strong>
                      <div style={{ fontSize: '0.9em', color: '#666' }}>
                        {account.institutionName} • {account.accountSubtype || account.accountType}
                        <span style={{ 
                          marginLeft: '10px', 
                          padding: '2px 8px', 
                          backgroundColor: account.accountTaxType === 'tax-free' ? '#d4edda' : 
                                          account.accountTaxType === 'tax-deferred' ? '#fff3cd' : '#d1ecf1',
                          borderRadius: '4px',
                          fontSize: '0.85em'
                        }}>
                          {account.accountTaxType || 'taxable'}
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong>{formatCurrency(account.totalValue)}</strong>
                      <div style={{ fontSize: '0.9em', color: '#666' }}>
                        {investments.totalValue > 0 ? (account.totalValue / investments.totalValue * 100).toFixed(1) : 0}% of total
                      </div>
                    </div>
                  </div>
                  
                  {/* Holdings in this account */}
                  <div style={{ marginTop: '15px' }}>
                    {account.holdings && account.holdings.length > 0 ? (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #e1e5e9' }}>
                            <th style={{ textAlign: 'left', padding: '8px' }}>Security</th>
                            <th style={{ textAlign: 'right', padding: '8px' }}>Quantity</th>
                            <th style={{ textAlign: 'right', padding: '8px' }}>Price</th>
                            <th style={{ textAlign: 'right', padding: '8px' }}>Value</th>
                            <th style={{ textAlign: 'right', padding: '8px' }}>% of Account</th>
                          </tr>
                        </thead>
                        <tbody>
                          {account.holdings.map((holding, hIdx) => (
                            <tr key={hIdx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                              <td style={{ padding: '8px' }}>
                                <div>
                                  <strong>{holding.securityName}</strong>
                                  {holding.securityTicker && (
                                    <span style={{ color: '#666', marginLeft: '8px' }}>({holding.securityTicker})</span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.85em', color: '#999' }}>{holding.securityType}</div>
                              </td>
                              <td style={{ textAlign: 'right', padding: '8px' }}>{holding.quantity.toFixed(4)}</td>
                              <td style={{ textAlign: 'right', padding: '8px' }}>{formatCurrency(holding.price)}</td>
                              <td style={{ textAlign: 'right', padding: '8px', fontWeight: '600' }}>{formatCurrency(holding.value)}</td>
                              <td style={{ textAlign: 'right', padding: '8px', color: '#666' }}>{holding.percentage.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{ color: '#999', fontStyle: 'italic' }}>No holdings in this account</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Statement Upload Section */}
        <StatementUpload client={client} />
      </div>
    </div>
  );
}

export default App;