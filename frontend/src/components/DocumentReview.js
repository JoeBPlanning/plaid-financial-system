import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import axios from 'axios';
import config from '../config';

const DocumentReview = ({ selectedClient }) => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [showOCRModal, setShowOCRModal] = useState(false);
  const [ocrData, setOcrData] = useState(null);
  const [editingOCR, setEditingOCR] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (selectedClient) {
      loadDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient, filterStatus]);

  const loadDocuments = async () => {
    if (!selectedClient) return;

    setLoading(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await axios.get(
        `${config.API_BASE}/api/clients/${selectedClient.clientId}/statements`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      let docs = response.data.documents || [];

      // Filter by status
      if (filterStatus !== 'all') {
        docs = docs.filter(doc => doc.status === filterStatus);
      }

      // Sort by upload date (newest first)
      docs.sort((a, b) => new Date(b.upload_date) - new Date(a.upload_date));

      setDocuments(docs);
    } catch (err) {
      console.error('Error loading documents:', err);
      setError('Failed to load documents');
    }

    setLoading(false);
  };

  const downloadDocument = async (doc) => {
    try {
      const { data, error } = await supabase.storage
        .from('client-statements')
        .download(doc.file_path);

      if (error) throw error;

      // Create download link
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      window.alert('Failed to download file');
    }
  };

  const viewOCRData = (doc) => {
    setSelectedDocument(doc);
    setOcrData(doc.ocr_data || null);
    setEditingOCR(false);
    setShowOCRModal(true);
  };

  const processOCR = async (doc) => {
    if (!window.confirm(`Start OCR processing for ${doc.filename}?`)) return;

    setProcessing(true);
    setError('');
    setSuccess('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.post(
        `${config.API_BASE}/api/admin/statements/${doc.id}/process-ocr`,
        {},
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      setSuccess(`OCR processing started for ${doc.filename}`);
      setTimeout(() => {
        loadDocuments();
        setSuccess('');
      }, 2000);
    } catch (err) {
      console.error('OCR processing error:', err);
      setError(err.response?.data?.error || 'Failed to process OCR');
    }

    setProcessing(false);
  };

  const saveOCRData = async () => {
    if (!selectedDocument || !ocrData) return;

    setProcessing(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.put(
        `${config.API_BASE}/api/admin/statements/${selectedDocument.id}/ocr-data`,
        { ocrData },
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      setSuccess('OCR data updated successfully');
      setEditingOCR(false);
      loadDocuments();
    } catch (err) {
      console.error('Error saving OCR data:', err);
      setError('Failed to save OCR data');
    }

    setProcessing(false);
  };

  const approveAndImport = async (doc) => {
    if (!doc.ocr_data) {
      window.alert('No OCR data available. Please process OCR first.');
      return;
    }

    if (!window.confirm(`Approve and import data from ${doc.filename}? This will create balance sheet entries.`)) return;

    setProcessing(true);
    setError('');
    setSuccess('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.post(
        `${config.API_BASE}/api/admin/statements/${doc.id}/approve`,
        {},
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        }
      );

      setSuccess(`Successfully approved and imported data from ${doc.filename}`);
      setTimeout(() => {
        loadDocuments();
        setSuccess('');
      }, 2000);
    } catch (err) {
      console.error('Approval error:', err);
      setError(err.response?.data?.error || 'Failed to approve and import');
    }

    setProcessing(false);
  };

  const rejectDocument = async (doc) => {
    const reason = window.prompt('Reason for rejection:');
    if (!reason) return;

    setProcessing(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      await axios.post(
        `${config.API_BASE}/api/admin/statements/${doc.id}/reject`,
        { reason },
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      setSuccess(`Document rejected: ${doc.filename}`);
      setTimeout(() => {
        loadDocuments();
        setSuccess('');
      }, 2000);
    } catch (err) {
      console.error('Rejection error:', err);
      setError('Failed to reject document');
    }

    setProcessing(false);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return '#ffc107';
      case 'processing': return '#17a2b8';
      case 'processed': return '#007bff';
      case 'approved': return '#28a745';
      case 'rejected': return '#dc3545';
      default: return '#6c757d';
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
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
      'investment': 'Investment',
      'loan': 'Loan',
      'other': 'Other'
    };
    return labels[type] || type;
  };

  if (!selectedClient) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
        Select a client to view their uploaded statements
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Uploaded Statements - {selectedClient.name}</h2>

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

      {/* Filters */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ marginRight: '10px', fontWeight: '500' }}>Filter by Status:</label>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={{
            padding: '8px 12px',
            fontSize: '14px',
            border: '2px solid #e1e5e9',
            borderRadius: '6px',
            backgroundColor: 'white'
          }}
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="processed">Processed</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Documents Table */}
      {loading ? (
        <p style={{ textAlign: 'center' }}>Loading documents...</p>
      ) : documents.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#999', fontStyle: 'italic' }}>
          No documents found
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e1e5e9', backgroundColor: '#f8f9fa' }}>
                <th style={{ textAlign: 'left', padding: '12px 8px' }}>Upload Date</th>
                <th style={{ textAlign: 'left', padding: '12px 8px' }}>Statement Date</th>
                <th style={{ textAlign: 'left', padding: '12px 8px' }}>Account Type</th>
                <th style={{ textAlign: 'left', padding: '12px 8px' }}>Filename</th>
                <th style={{ textAlign: 'center', padding: '12px 8px' }}>Status</th>
                <th style={{ textAlign: 'center', padding: '12px 8px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '12px 8px' }}>{formatDate(doc.upload_date)}</td>
                  <td style={{ padding: '12px 8px' }}>{formatStatementDate(doc.statement_date)}</td>
                  <td style={{ padding: '12px 8px' }}>{getAccountTypeLabel(doc.account_type)}</td>
                  <td style={{ padding: '12px 8px', fontSize: '13px' }}>
                    {doc.filename}
                    {doc.notes && (
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                        Note: {doc.notes}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '600',
                      backgroundColor: getStatusColor(doc.status) + '22',
                      color: getStatusColor(doc.status),
                      border: `1px solid ${getStatusColor(doc.status)}44`
                    }}>
                      {doc.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => downloadDocument(doc)}
                        style={{
                          padding: '6px 12px',
                          fontSize: '12px',
                          backgroundColor: '#6c757d',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        Download
                      </button>

                      {doc.status === 'pending' && (
                        <button
                          onClick={() => processOCR(doc)}
                          disabled={processing}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            backgroundColor: '#17a2b8',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: processing ? 'not-allowed' : 'pointer',
                            opacity: processing ? 0.6 : 1
                          }}
                        >
                          Process OCR
                        </button>
                      )}

                      {(doc.status === 'processed' || doc.status === 'processing') && (
                        <>
                          <button
                            onClick={() => viewOCRData(doc)}
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              backgroundColor: '#007bff',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer'
                            }}
                          >
                            View OCR
                          </button>
                          <button
                            onClick={() => approveAndImport(doc)}
                            disabled={processing}
                            style={{
                              padding: '6px 12px',
                              fontSize: '12px',
                              backgroundColor: '#28a745',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: processing ? 'not-allowed' : 'pointer',
                              opacity: processing ? 0.6 : 1
                            }}
                          >
                            Approve & Import
                          </button>
                        </>
                      )}

                      {doc.status !== 'approved' && doc.status !== 'rejected' && (
                        <button
                          onClick={() => rejectDocument(doc)}
                          disabled={processing}
                          style={{
                            padding: '6px 12px',
                            fontSize: '12px',
                            backgroundColor: '#dc3545',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: processing ? 'not-allowed' : 'pointer',
                            opacity: processing ? 0.6 : 1
                          }}
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* OCR Data Modal */}
      {showOCRModal && selectedDocument && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '800px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>OCR Data - {selectedDocument.filename}</h3>
              <button
                onClick={() => setShowOCRModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>

            {ocrData ? (
              <div>
                <div style={{ marginBottom: '15px' }}>
                  <button
                    onClick={() => setEditingOCR(!editingOCR)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      marginRight: '10px'
                    }}
                  >
                    {editingOCR ? 'Cancel Edit' : 'Edit OCR Data'}
                  </button>

                  {editingOCR && (
                    <button
                      onClick={saveOCRData}
                      disabled={processing}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: processing ? 'not-allowed' : 'pointer',
                        opacity: processing ? 0.6 : 1
                      }}
                    >
                      Save Changes
                    </button>
                  )}
                </div>

                {editingOCR ? (
                  <textarea
                    value={JSON.stringify(ocrData, null, 2)}
                    onChange={(e) => {
                      try {
                        setOcrData(JSON.parse(e.target.value));
                      } catch (err) {
                        // Invalid JSON, keep editing
                      }
                    }}
                    style={{
                      width: '100%',
                      minHeight: '400px',
                      fontFamily: 'monospace',
                      fontSize: '12px',
                      padding: '12px',
                      border: '1px solid #e1e5e9',
                      borderRadius: '4px'
                    }}
                  />
                ) : (
                  <pre style={{
                    backgroundColor: '#f8f9fa',
                    padding: '12px',
                    borderRadius: '4px',
                    overflow: 'auto',
                    fontSize: '12px',
                    maxHeight: '500px'
                  }}>
                    {JSON.stringify(ocrData, null, 2)}
                  </pre>
                )}
              </div>
            ) : (
              <p style={{ color: '#999', fontStyle: 'italic' }}>No OCR data available yet. Process OCR first.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DocumentReview;
