import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_BASE || 'https://plaid-financial-system-api.onrender.com';

const StatementUpload = ({ client }) => {
  const [file, setFile] = useState(null);
  const [accountType, setAccountType] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [notes, setNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load existing documents
  useEffect(() => {
    if (client) {
      loadDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await axios.get(
        `${API_BASE}/api/clients/${client.clientId}/statements`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );
      setDocuments(response.data.documents || []);
    } catch (err) {
      console.error('Error loading documents:', err);
    }
    setLoading(false);
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setError('');
    setSuccess('');

    if (!selectedFile) {
      setFile(null);
      return;
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'text/csv'];
    if (!allowedTypes.includes(selectedFile.type)) {
      setError('Invalid file type. Please upload PDF, JPG, PNG, or CSV files only.');
      setFile(null);
      return;
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (selectedFile.size > maxSize) {
      setError('File size exceeds 10MB limit. Please choose a smaller file.');
      setFile(null);
      return;
    }

    setFile(selectedFile);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate inputs
    if (!file) {
      setError('Please select a file to upload');
      return;
    }
    if (!accountType) {
      setError('Please select an account type');
      return;
    }
    if (!statementDate) {
      setError('Please select the statement month/year');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Create file path: clientId/YYYY-MM/filename
      const [year, month] = statementDate.split('-');
      const fileExt = file.name.split('.').pop();
      const fileName = `${file.name}`;
      const filePath = `${client.clientId}/${year}-${month}/${fileName}`;

      // Upload to Supabase Storage
      setUploadProgress(30);
      const { error: uploadError } = await supabase.storage
        .from('client-statements')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        throw uploadError;
      }

      // Create document record in database via API
      setUploadProgress(60);
      await axios.post(
        `${API_BASE}/api/clients/${client.clientId}/upload-statement`,
        {
          filename: fileName,
          filePath: filePath,
          fileType: fileExt.toLowerCase(),
          fileSize: file.size,
          accountType: accountType,
          statementDate: statementDate + '-01', // Convert YYYY-MM to YYYY-MM-DD
          notes: notes
        },
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      setUploadProgress(100);
      setSuccess('Statement uploaded successfully! We will review and process it soon.');

      // Reset form
      setFile(null);
      setAccountType('');
      setStatementDate('');
      setNotes('');
      document.getElementById('file-input').value = '';

      // Reload documents
      setTimeout(() => {
        loadDocuments();
        setSuccess('');
      }, 2000);

    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || err.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const getStatusBadgeColor = (status) => {
    switch (status) {
      case 'pending':
        return '#ffc107';
      case 'processing':
        return '#17a2b8';
      case 'processed':
        return '#007bff';
      case 'approved':
        return '#28a745';
      case 'rejected':
        return '#dc3545';
      default:
        return '#6c757d';
    }
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'pending':
        return 'Pending Review';
      case 'processing':
        return 'Processing';
      case 'processed':
        return 'Processed';
      case 'approved':
        return 'Approved';
      case 'rejected':
        return 'Rejected';
      default:
        return status;
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatStatementDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long'
    });
  };

  const getAccountTypeLabel = (type) => {
    const labels = {
      'bank_statement': 'Bank Statement',
      'credit_card': 'Credit Card',
      'investment': 'Investment Account',
      'loan': 'Loan Statement',
      'other': 'Other'
    };
    return labels[type] || type;
  };

  return (
    <div style={{ marginTop: '30px' }}>
      <div className="financial-summary">
        <h2>Upload Account Statements</h2>
        <p style={{ color: '#666', marginBottom: '20px' }}>
          Upload your account statements for review and processing. Accepted formats: PDF, JPG, PNG, CSV (Max 10MB)
        </p>

        {/* Upload Form */}
        <form onSubmit={handleUpload} style={{ marginBottom: '30px' }}>
          {error && (
            <div style={{
              padding: '12px',
              marginBottom: '15px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '6px',
              border: '1px solid #f5c6cb'
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              padding: '12px',
              marginBottom: '15px',
              backgroundColor: '#d4edda',
              color: '#155724',
              borderRadius: '6px',
              border: '1px solid #c3e6cb'
            }}>
              {success}
            </div>
          )}

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Select File *
            </label>
            <input
              id="file-input"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.csv"
              onChange={handleFileChange}
              disabled={uploading}
              style={{
                width: '100%',
                padding: '10px',
                border: '2px solid #e1e5e9',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            />
            {file && (
              <div style={{ marginTop: '8px', fontSize: '14px', color: '#666' }}>
                Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
              </div>
            )}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Account Type *
            </label>
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              disabled={uploading}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '2px solid #e1e5e9',
                borderRadius: '8px',
                fontSize: '14px',
                backgroundColor: 'white'
              }}
            >
              <option value="">-- Select Account Type --</option>
              <option value="bank_statement">Bank Statement (Checking/Savings)</option>
              <option value="credit_card">Credit Card Statement</option>
              <option value="investment">Investment Account Statement</option>
              <option value="loan">Loan Statement</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Statement Month/Year *
            </label>
            <input
              type="month"
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
              disabled={uploading}
              required
              max={new Date().toISOString().slice(0, 7)}
              style={{
                width: '100%',
                padding: '10px',
                border: '2px solid #e1e5e9',
                borderRadius: '8px',
                fontSize: '14px'
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={uploading}
              placeholder="Add any additional notes about this statement..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px',
                border: '2px solid #e1e5e9',
                borderRadius: '8px',
                fontSize: '14px',
                fontFamily: 'inherit',
                resize: 'vertical'
              }}
            />
          </div>

          {uploading && (
            <div style={{ marginBottom: '15px' }}>
              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: '#e1e5e9',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${uploadProgress}%`,
                  height: '100%',
                  backgroundColor: '#2D5074',
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '14px', color: '#666' }}>
                Uploading... {uploadProgress}%
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={uploading || !file || !accountType || !statementDate}
            style={{
              padding: '12px 24px',
              backgroundColor: uploading ? '#ccc' : '#2D5074',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: uploading ? 'not-allowed' : 'pointer',
              width: '100%'
            }}
          >
            {uploading ? 'Uploading...' : 'Upload Statement'}
          </button>
        </form>

        {/* Previously Uploaded Statements */}
        <div style={{ borderTop: '2px solid #e1e5e9', paddingTop: '20px' }}>
          <h3 style={{ marginBottom: '15px' }}>Previously Uploaded Statements</h3>

          {loading ? (
            <p style={{ textAlign: 'center', color: '#666' }}>Loading documents...</p>
          ) : documents.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#999', fontStyle: 'italic' }}>
              No statements uploaded yet
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e1e5e9' }}>
                    <th style={{ textAlign: 'left', padding: '12px 8px' }}>Upload Date</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px' }}>Statement Date</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px' }}>Account Type</th>
                    <th style={{ textAlign: 'left', padding: '12px 8px' }}>Filename</th>
                    <th style={{ textAlign: 'center', padding: '12px 8px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '12px 8px' }}>{formatDate(doc.upload_date)}</td>
                      <td style={{ padding: '12px 8px' }}>{formatStatementDate(doc.statement_date)}</td>
                      <td style={{ padding: '12px 8px' }}>{getAccountTypeLabel(doc.account_type)}</td>
                      <td style={{ padding: '12px 8px', fontSize: '13px' }}>{doc.filename}</td>
                      <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          backgroundColor: getStatusBadgeColor(doc.status) + '22',
                          color: getStatusBadgeColor(doc.status),
                          border: `1px solid ${getStatusBadgeColor(doc.status)}44`
                        }}>
                          {getStatusLabel(doc.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatementUpload;
