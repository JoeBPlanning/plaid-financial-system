import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import '../App.css';

function AdminInviteGenerator() {
  const { user } = useAuth();
  const [clientName, setClientName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedCode, setGeneratedCode] = useState(null);
  const [invites, setInvites] = useState([]);
  const [filter, setFilter] = useState('all'); // all, active, used, expired
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [emailStatus, setEmailStatus] = useState(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    fetchInvites();
    fetchEmailStatus();
  }, [filter, searchTerm]);

  const fetchInvites = async () => {
    try {
      const params = new URLSearchParams();
      if (filter !== 'all') params.append('status', filter);
      if (searchTerm) params.append('search', searchTerm);

      const response = await api.get(`/api/invites?${params.toString()}`);
      setInvites(response.data.inviteCodes || []);
    } catch (error) {
      console.error('Error fetching invites:', error);
    }
  };

  const fetchEmailStatus = async () => {
    try {
      const response = await api.get('/api/invites/email-status');
      setEmailStatus(response.data);
    } catch (error) {
      console.error('Error fetching email status:', error);
    }
  };

  const handleGenerateInvite = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setGeneratedCode(null);
    setLoading(true);

    try {
      const response = await api.post('/api/invites/generate', {
        clientName,
        email
      });

      setGeneratedCode(response.data.inviteCode);
      setSuccess(`Invite code generated successfully!`);
      setClientName('');
      setEmail('');
      fetchInvites(); // Refresh list
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to generate invite code');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = (code) => {
    navigator.clipboard.writeText(code);
    setSuccess(`Copied ${code} to clipboard!`);
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleCopyRegistrationLink = (code) => {
    const url = `${window.location.origin}/register?code=${code}`;
    navigator.clipboard.writeText(url);
    setSuccess(`Copied registration link to clipboard!`);
    setTimeout(() => setSuccess(''), 3000);
  };

  const handleSendEmail = async (code) => {
    setSendingEmail(true);
    setError('');
    setSuccess('');

    try {
      const response = await api.post('/api/invites/send-email', {
        inviteCode: code
      });

      setSuccess(`Email sent successfully!`);
    } catch (error) {
      const errorData = error.response?.data;

      if (errorData?.emailContent) {
        // Email provider not configured - show email content
        setError(`Email provider not configured. ${errorData.suggestion}`);
        console.log('Email content:', errorData.emailContent);
      } else {
        setError(errorData?.error || 'Failed to send email');
      }
    } finally {
      setSendingEmail(false);
    }
  };

  const handleDeleteInvite = async (code) => {
    if (!window.confirm('Are you sure you want to delete this invite code?')) {
      return;
    }

    try {
      await api.delete(`/api/invites/${code}`);
      setSuccess('Invite code deleted successfully');
      fetchInvites();
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to delete invite code');
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (invite) => {
    if (invite.isUsed) {
      return <span className="badge badge-success">Used</span>;
    }
    if (invite.isExpired) {
      return <span className="badge badge-expired">Expired</span>;
    }
    return <span className="badge badge-active">Active</span>;
  };

  return (
    <div className="admin-invite-container">
      <div className="admin-header">
        <h1>Invite Code Generator</h1>
        <p>Generate invite codes for new clients</p>
      </div>

      {/* Email Service Status */}
      {emailStatus && (
        <div className={`email-status ${emailStatus.hasProvider ? 'configured' : 'not-configured'}`}>
          <strong>Email Service:</strong>{' '}
          {emailStatus.hasProvider ? (
            <span>✓ {emailStatus.activeProvider} configured</span>
          ) : (
            <span>⚠️ Not configured (codes can be copied manually)</span>
          )}
        </div>
      )}

      {/* Error/Success Messages */}
      {error && <div className="error-message">{error}</div>}
      {success && <div className="success-message">{success}</div>}

      {/* Generate Invite Form */}
      <div className="invite-form-card">
        <h2>Generate New Invite</h2>
        <form onSubmit={handleGenerateInvite}>
          <div className="form-group">
            <label htmlFor="clientName">Client Name *</label>
            <input
              type="text"
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="John Doe"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Client Email *</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
          >
            {loading ? 'Generating...' : 'Generate Invite Code'}
          </button>
        </form>

        {/* Generated Code Display */}
        {generatedCode && (
          <div className="generated-code-box">
            <h3>✓ Invite Code Generated!</h3>

            <div className="invite-code-display">
              <span className="code">{generatedCode.code}</span>
            </div>

            <div className="invite-details">
              <p><strong>Client:</strong> {generatedCode.clientName}</p>
              <p><strong>Email:</strong> {generatedCode.email}</p>
              <p><strong>Expires:</strong> {formatDate(generatedCode.expiresAt)}</p>
            </div>

            <div className="action-buttons">
              <button
                className="btn btn-secondary"
                onClick={() => handleCopyCode(generatedCode.code)}
              >
                📋 Copy Code
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => handleCopyRegistrationLink(generatedCode.code)}
              >
                🔗 Copy Registration Link
              </button>

              {emailStatus?.hasProvider && (
                <button
                  className="btn btn-success"
                  onClick={() => handleSendEmail(generatedCode.code)}
                  disabled={sendingEmail}
                >
                  {sendingEmail ? '✉️ Sending...' : '✉️ Send Email'}
                </button>
              )}
            </div>

            <div className="registration-url">
              <small>
                <strong>Registration URL:</strong><br />
                {generatedCode.registrationUrl}
              </small>
            </div>
          </div>
        )}
      </div>

      {/* Invite Codes List */}
      <div className="invites-list-card">
        <div className="list-header">
          <h2>Invite Codes</h2>

          <div className="list-controls">
            {/* Search */}
            <input
              type="text"
              className="search-input"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            {/* Filter */}
            <select
              className="filter-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All Invites</option>
              <option value="active">Active</option>
              <option value="used">Used</option>
              <option value="expired">Expired</option>
            </select>
          </div>
        </div>

        <div className="invites-table-container">
          <table className="invites-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Client Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Created</th>
                <th>Used</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px' }}>
                    No invite codes found
                  </td>
                </tr>
              ) : (
                invites.map((invite) => (
                  <tr key={invite.id}>
                    <td>
                      <code className="invite-code-cell">{invite.code}</code>
                    </td>
                    <td>{invite.clientName}</td>
                    <td>{invite.email}</td>
                    <td>{getStatusBadge(invite)}</td>
                    <td>{formatDate(invite.createdAt)}</td>
                    <td>{formatDate(invite.usedAt)}</td>
                    <td>{formatDate(invite.expiresAt)}</td>
                    <td>
                      <div className="action-buttons-cell">
                        <button
                          className="btn-icon"
                          onClick={() => handleCopyCode(invite.code)}
                          title="Copy code"
                        >
                          📋
                        </button>

                        {!invite.isUsed && !invite.isExpired && emailStatus?.hasProvider && (
                          <button
                            className="btn-icon"
                            onClick={() => handleSendEmail(invite.code)}
                            title="Send email"
                          >
                            ✉️
                          </button>
                        )}

                        {!invite.isUsed && (
                          <button
                            className="btn-icon btn-delete"
                            onClick={() => handleDeleteInvite(invite.code)}
                            title="Delete"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <p>Total: {invites.length} invite code(s)</p>
        </div>
      </div>

      <style jsx>{`
        .admin-invite-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }

        .admin-header {
          margin-bottom: 30px;
        }

        .admin-header h1 {
          margin: 0 0 10px 0;
          color: #2c5282;
        }

        .admin-header p {
          margin: 0;
          color: #718096;
        }

        .email-status {
          padding: 12px;
          border-radius: 5px;
          margin-bottom: 20px;
          font-size: 14px;
        }

        .email-status.configured {
          background-color: #c6f6d5;
          border: 1px solid #9ae6b4;
          color: #22543d;
        }

        .email-status.not-configured {
          background-color: #fef5e7;
          border: 1px solid #f6e05e;
          color: #744210;
        }

        .invite-form-card,
        .invites-list-card {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
          padding: 30px;
          margin-bottom: 30px;
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
          padding: 10px;
          border: 1px solid #cbd5e0;
          border-radius: 5px;
          font-size: 16px;
        }

        .generated-code-box {
          margin-top: 30px;
          padding: 20px;
          background: #f7fafc;
          border: 2px solid #2c5282;
          border-radius: 8px;
        }

        .generated-code-box h3 {
          margin-top: 0;
          color: #2c5282;
        }

        .invite-code-display {
          text-align: center;
          margin: 20px 0;
        }

        .invite-code-display .code {
          display: inline-block;
          font-size: 32px;
          font-weight: bold;
          font-family: 'Courier New', monospace;
          letter-spacing: 3px;
          color: #2c5282;
          padding: 15px 30px;
          background: white;
          border: 2px dashed #2c5282;
          border-radius: 5px;
        }

        .invite-details {
          margin: 20px 0;
        }

        .invite-details p {
          margin: 8px 0;
          color: #4a5568;
        }

        .action-buttons {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          margin: 20px 0;
        }

        .registration-url {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #e2e8f0;
        }

        .registration-url small {
          color: #718096;
          word-break: break-all;
        }

        .list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          flex-wrap: wrap;
          gap: 15px;
        }

        .list-controls {
          display: flex;
          gap: 10px;
        }

        .search-input,
        .filter-select {
          padding: 8px 12px;
          border: 1px solid #cbd5e0;
          border-radius: 5px;
        }

        .search-input {
          width: 250px;
        }

        .invites-table-container {
          overflow-x: auto;
        }

        .invites-table {
          width: 100%;
          border-collapse: collapse;
        }

        .invites-table th,
        .invites-table td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }

        .invites-table th {
          background-color: #f7fafc;
          font-weight: 600;
          color: #2d3748;
        }

        .invites-table tr:hover {
          background-color: #f7fafc;
        }

        .invite-code-cell {
          font-family: 'Courier New', monospace;
          font-size: 14px;
          font-weight: bold;
          background-color: #edf2f7;
          padding: 4px 8px;
          border-radius: 3px;
        }

        .badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .badge-success {
          background-color: #c6f6d5;
          color: #22543d;
        }

        .badge-active {
          background-color: #bee3f8;
          color: #2c5282;
        }

        .badge-expired {
          background-color: #fed7d7;
          color: #742a2a;
        }

        .action-buttons-cell {
          display: flex;
          gap: 5px;
        }

        .btn-icon {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 3px;
          transition: background-color 0.2s;
        }

        .btn-icon:hover {
          background-color: #edf2f7;
        }

        .btn-delete:hover {
          background-color: #fed7d7;
        }

        .table-footer {
          margin-top: 15px;
          color: #718096;
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}

export default AdminInviteGenerator;
