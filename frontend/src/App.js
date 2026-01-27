import React, { useState, useEffect, useCallback } from 'react';
import api from './api';
// Plaid integration removed - using statement upload + OCR instead
// Chart.js imports removed - investments functionality removed
import './App.css';
import AdminDashboard from './AdminDashboard';
import TransactionReview from './TransactionReview';
import {
  supabase,
  signUp,
  signIn,
  signOut,
  getSession,
  updatePassword,
  onAuthStateChange,
  validatePassword,
} from './supabaseClient'; // Removed unused 'config' import
import Footer from './components/Footer';
import DataSecurityModal from './components/DataSecurityModal';

function App() {
  // Helper function for email validation (moved from supabaseClient.js as requested)
  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const [step, setStep] = useState('login');
  const [authMode, setAuthMode] = useState('login'); // 'login', 'register', 'forgot-password'
  // eslint-disable-next-line no-unused-vars
  const [user, setUser] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [session, setSession] = useState(null);
  const [client, setClient] = useState(null);
  // Plaid linkToken removed
  const [loading, setLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [monthlySummary, setMonthlySummary] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [currentNetWorth, setCurrentNetWorth] = useState(null);
  // Investments functionality removed
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isPasswordReset, setIsPasswordReset] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showDataSecurityModal, setShowDataSecurityModal] = useState(false);
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

  // Plaid integration removed - using statement upload + OCR instead

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

  // Load monthly summary for client (simplified for faster loading)
  const loadMonthlySummary = useCallback(async (clientId, month = null) => {
    const targetMonth = month || selectedMonth;
    try {
      // Just fetch existing summaries - don't try to generate on initial load
      const response = await api.get(`/api/clients/${clientId}/summaries?limit=12`);
      if (response.data.summaries && response.data.summaries.length > 0) {
        // Find summary for the target month
        const monthSummary = response.data.summaries.find(s => s.monthYear === targetMonth);
        if (monthSummary) {
          setMonthlySummary(monthSummary);
        } else {
          // If not found, use the most recent one as a fallback
          setMonthlySummary(response.data.summaries[0]);
        }
      }
      // If no summaries exist, user can click "Refresh Financial Data" to generate
    } catch (error) {
      console.error('Error loading monthly summary:', error);
    }
  }, [selectedMonth]);

  // Load current net worth from existing summary (don't process on load)
  const loadCurrentNetWorth = useCallback(async (clientId) => {
    try {
      // Just get the most recent summary's net worth - don't reprocess
      const response = await api.get(`/api/clients/${clientId}/summaries?limit=1`);
      if (response.data.summaries && response.data.summaries.length > 0) {
        const summary = response.data.summaries[0];
        if (summary.netWorth) {
          setCurrentNetWorth(summary.netWorth);
        }
      }
    } catch (error) {
      console.error('Error loading current net worth:', error);
    }
  }, []);

  // Check for unreviewed transactions
  const checkUnreviewedTransactions = useCallback(async (clientId) => { // Wrapped in useCallback
    try {
      const currentMonth = new Date().toISOString().slice(0, 7); // Corrected slice to get YYYY-MM
      const response = await api.get(
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
      console.error('Error checking unreviewed transactions:', error);
    }
  }, [setUnreviewedCount, setShowReview, setStep]);

  // Check session on mount
  useEffect(() => {
    let dataLoaded = false; // Prevent duplicate data loading
    
    const loadUserData = async (userId) => {
      if (dataLoaded) return; // Skip if already loaded
      dataLoaded = true;
      console.log('Loading user data...');
      // Run all data fetching in parallel for faster loading
      await Promise.all([
        loadMonthlySummary(userId, selectedMonth),
        checkUnreviewedTransactions(userId),
        loadCurrentNetWorth(userId)
      ]).catch(err => console.error('Error loading user data:', err));
    };

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
          // Load dashboard data
          await loadUserData(session.user.id);
        }
      } catch (error) {
        console.error('Session check error:', error);
      } finally {
        setAuthLoading(false);
      }
    };

    initAuth();

    // Listen for auth changes (handles fresh sign-ins and sign-outs)
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
        setStep('dashboard');

        // Only load data if not already loaded by initAuth
        await loadUserData(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        dataLoaded = false; // Reset flag on sign out
        setSession(null);
        setUser(null);
        setClient(null);
        setMonthlySummary(null); // Clear stale data
        setStep('login');
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [loadMonthlySummary, checkUnreviewedTransactions, loadCurrentNetWorth, selectedMonth, setAuthLoading, setIsPasswordReset, setStep, setSession, setUser, setClient, setMonthlySummary, getSession, onAuthStateChange]); // Cleaned up dependencies

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
      console.log('User logged in successfully - fetching user data...');
      await loadMonthlySummary(data.user.id, selectedMonth);
      await checkUnreviewedTransactions(data.user.id);
      await loadCurrentNetWorth(data.user.id);

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

      // Moved resetPassword logic here to avoid importing from supabaseClient.js
      const { error } = await supabase.auth.resetPasswordForEmail(authForm.email, {
        redirectTo: `${window.location.origin}/reset-password`
      });

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
      // Investments functionality removed
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Load current net worth when client changes
  useEffect(() => {
    if (client && step === 'dashboard') {
      loadCurrentNetWorth(client.clientId);
      // loadInvestments(client.clientId); // Disabled - investments not needed
    } // Added loadCurrentNetWorth
  }, [client, step, loadCurrentNetWorth]);

  // Plaid integration removed - users upload statements instead

  // Process transactions for the client
  const processTransactions = async (useReviewedTransactions = false) => {
    try {
      const response = await api.post(`/api/process-transactions/${client.clientId}`, {
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
      await api.post(`/api/clients/${client.clientId}/sync-transactions`);
      
      // Sync investments - DISABLED
      // try {
      //   await api.post(`/api/clients/${client.clientId}/sync-investments`);
      // } catch (invError) {
      //   console.warn('Could not sync investments:', invError);
      //   // Don't fail the whole refresh if investments fail
      // }
      
      // Process transactions to generate summary
      await processTransactions(true);
      
      // Reload monthly summary
      await loadMonthlySummary(client.clientId, selectedMonth);
      
      // Reload investments - DISABLED
      // await loadInvestments(client.clientId);
      
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

  // Plaid integration removed

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
          <p>Upload your account statements to get your monthly financial report</p>

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

  const handleOpenDataSecurityModal = () => setShowDataSecurityModal(true);
  const handleCloseDataSecurityModal = () => setShowDataSecurityModal(false);


  // Plaid connecting step removed - using statement upload instead

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
        <Footer onOpenDataSecurityModal={handleOpenDataSecurityModal} />
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
                              {/* Investments removed */}
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
          </div>
        ) : (
          <div className="no-data">
            <h3>No Financial Data Yet</h3>
            <p>Click "Refresh Financial Data" to sync your transactions, or "Review Transactions" to categorize them.</p>
          </div>
        )}


        <DataSecurityModal isOpen={showDataSecurityModal} onClose={handleCloseDataSecurityModal} />
      </div>
    </div>
  );
}

export default App;