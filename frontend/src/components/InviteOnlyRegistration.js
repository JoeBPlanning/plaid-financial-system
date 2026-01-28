import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';
import '../App.css';

function InviteOnlyRegistration() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { signUp } = useAuth();

  // Two-step registration flow
  const [step, setStep] = useState(1); // 1 = Enter Code, 2 = Complete Registration

  // Step 1: Invite Code
  const [inviteCode, setInviteCode] = useState(searchParams.get('code') || '');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [inviteData, setInviteData] = useState(null);

  // Step 2: Registration Form
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registering, setRegistering] = useState(false);

  // Messages
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Auto-verify code if provided in URL
  useEffect(() => {
    const codeFromUrl = searchParams.get('code');
    if (codeFromUrl) {
      setInviteCode(codeFromUrl);
      handleVerifyCode(codeFromUrl);
    }
  }, [searchParams]);

  /**
   * Step 1: Verify Invite Code
   */
  const handleVerifyCode = async (code = inviteCode) => {
    setError('');
    setSuccess('');
    setVerifyingCode(true);

    try {
      // Verify invite code via backend
      const response = await api.get(`/api/invites/verify/${code.toUpperCase()}`);

      if (response.data.isValid) {
        setInviteData(response.data.invite);
        setEmail(response.data.invite.email);
        setName(response.data.invite.clientName);
        setStep(2); // Move to registration form
      } else {
        setError(response.data.error || 'Invalid invite code');
      }
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Failed to verify invite code';
      setError(errorMsg);
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleSubmitCode = (e) => {
    e.preventDefault();

    if (!inviteCode.trim()) {
      setError('Please enter an invite code');
      return;
    }

    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(inviteCode)) {
      setError('Invalid invite code format. Use format: XXXX-YYYY');
      return;
    }

    handleVerifyCode();
  };

  /**
   * Step 2: Complete Registration
   */
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validation
    if (!name.trim()) {
      setError('Please enter your full name');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setRegistering(true);

    try {
      // Create Supabase auth account
      await signUp(email, password, {
        name: name,
        role: 'user',
        advisor_id: 'advisor_main', // Default advisor
        invite_code: inviteCode.toUpperCase()
      });

      // Mark invite code as used
      await api.post('/api/invites/mark-used', {
        code: inviteCode.toUpperCase(),
        email: email
      });

      // Show success message
      setSuccess('Account created successfully! Check your email to verify your account.');

      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (error) {
      console.error('Registration error:', error);

      const errorMsg = error.response?.data?.error ||
                      error.error_description ||
                      error.message ||
                      'Registration failed. Please try again.';

      setError(errorMsg);
    } finally {
      setRegistering(false);
    }
  };

  /**
   * Render Step 1: Enter Invite Code
   */
  if (step === 1) {
    return (
      <div className="registration-container">
        <div className="registration-card">
          <div className="registration-header">
            <h1>Welcome to Financial Progress Portal</h1>
            <p>You need an invite code to register</p>
          </div>

          {error && <div className="error-message">{error}</div>}

          <form onSubmit={handleSubmitCode}>
            <div className="form-group">
              <label htmlFor="inviteCode">
                Enter Your Invite Code
              </label>
              <input
                type="text"
                id="inviteCode"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="XXXX-YYYY"
                maxLength={9}
                required
                autoFocus
                style={{
                  fontSize: '20px',
                  letterSpacing: '2px',
                  fontFamily: 'monospace',
                  textAlign: 'center'
                }}
              />
              <small className="form-hint">
                Format: XXXX-YYYY (8 characters)
              </small>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              disabled={verifyingCode}
            >
              {verifyingCode ? 'Verifying...' : 'Continue'}
            </button>
          </form>

          <div className="registration-footer">
            <p>
              Don't have an invite code?<br />
              Contact your financial advisor to request one.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /**
   * Render Step 2: Complete Registration
   */
  return (
    <div className="registration-container">
      <div className="registration-card">
        <div className="registration-header">
          <h1>Create Your Account</h1>
          <p>Complete your registration</p>
        </div>

        {/* Show verified invite info */}
        <div className="invite-verified-box">
          <div className="verified-icon">✓</div>
          <div className="verified-text">
            <strong>Invite Code Verified</strong>
            <p>Welcome, {inviteData?.clientName}!</p>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <form onSubmit={handleRegister}>
          <div className="form-group">
            <label htmlFor="name">Full Name *</label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address *</label>
            <input
              type="email"
              id="email"
              value={email}
              readOnly
              style={{
                backgroundColor: '#f7fafc',
                cursor: 'not-allowed'
              }}
            />
            <small className="form-hint">
              Email is pre-filled from your invite and cannot be changed
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password *</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 6 characters"
              minLength={6}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm Password *</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              minLength={6}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={registering}
          >
            {registering ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        <div className="registration-footer">
          <p>
            Already have an account?{' '}
            <a href="/login">Sign in here</a>
          </p>

          <p style={{ marginTop: '15px' }}>
            <button
              type="button"
              className="btn-link"
              onClick={() => setStep(1)}
            >
              ← Use a different invite code
            </button>
          </p>
        </div>
      </div>

      <style jsx>{`
        .registration-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #2D5074 0%, #010101 100%);
          padding: 20px;
        }

        .registration-card {
          background: white;
          border-radius: 8px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
          padding: 40px;
          max-width: 500px;
          width: 100%;
        }

        .registration-header {
          text-align: center;
          margin-bottom: 30px;
        }

        .registration-header h1 {
          color: #2c5282;
          margin: 0 0 10px 0;
          font-size: 28px;
        }

        .registration-header p {
          color: #718096;
          margin: 0;
        }

        .invite-verified-box {
          background-color: #c6f6d5;
          border: 2px solid #48bb78;
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 25px;
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .verified-icon {
          font-size: 32px;
          color: #22543d;
        }

        .verified-text strong {
          display: block;
          color: #22543d;
          margin-bottom: 5px;
        }

        .verified-text p {
          margin: 0;
          color: #22543d;
          font-size: 14px;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-weight: 600;
          color: #2d3748;
        }

        .form-group input {
          width: 100%;
          padding: 12px;
          border: 1px solid #cbd5e0;
          border-radius: 5px;
          font-size: 16px;
        }

        .form-group input:focus {
          outline: none;
          border-color: #2D5074;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .form-hint {
          display: block;
          margin-top: 5px;
          color: #718096;
          font-size: 14px;
        }

        .btn-block {
          width: 100%;
        }

        .registration-footer {
          margin-top: 25px;
          text-align: center;
          color: #718096;
          font-size: 14px;
        }

        .registration-footer a {
          color: #2D5074;
          text-decoration: none;
        }

        .registration-footer a:hover {
          text-decoration: underline;
        }

        .btn-link {
          background: none;
          border: none;
          color: #2D5074;
          cursor: pointer;
          font-size: 14px;
          text-decoration: none;
        }

        .btn-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}

export default InviteOnlyRegistration;
