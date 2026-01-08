/**
 * PDF Storage Service
 * Handles Supabase Storage operations for PDF reports
 */

const { getDatabase } = require('../database-supabase');
const moment = require('moment');

/**
 * Upload PDF buffer to Supabase Storage
 *
 * @param {Buffer} pdfBuffer - PDF file as buffer
 * @param {string} clientId - Client UUID
 * @param {string} reportType - Type of report (monthly_cash_flow, net_worth, etc.)
 * @param {string} reportDate - Report date (YYYY-MM or YYYY)
 * @returns {Promise<Object>} Object with filePath and filename
 */
async function uploadPDF(pdfBuffer, clientId, reportType, reportDate) {
  const supabase = getDatabase();

  // Generate unique filename
  const timestamp = Date.now();
  const year = moment(reportDate, ['YYYY-MM', 'YYYY']).format('YYYY');
  const filename = `${reportType}_${moment(reportDate).format('YYYY-MM')}_${timestamp}.pdf`;

  // Construct storage path: {clientId}/{year}/{reportType}/filename.pdf
  const filePath = `${clientId}/${year}/${reportType}/${filename}`;

  // Upload to Supabase Storage
  const { data, error } = await supabase.storage
    .from('client-reports')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false, // Don't overwrite existing files
      cacheControl: '3600' // Cache for 1 hour
    });

  if (error) {
    console.error('❌ Error uploading PDF to storage:', error);
    throw new Error(`Failed to upload PDF: ${error.message}`);
  }

  console.log(`📄 PDF uploaded to storage: ${filePath}`);

  return {
    filePath,
    filename
  };
}

/**
 * Generate a signed URL for PDF download
 *
 * @param {string} filePath - Storage path to the PDF
 * @param {number} expiresIn - Expiry time in seconds (default: 3600 = 1 hour)
 * @returns {Promise<string>} Signed URL
 */
async function getSignedURL(filePath, expiresIn = 3600) {
  const supabase = getDatabase();

  const { data, error } = await supabase.storage
    .from('client-reports')
    .createSignedUrl(filePath, expiresIn);

  if (error) {
    console.error('❌ Error creating signed URL:', error);
    throw new Error(`Failed to create signed URL: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Delete a PDF from Supabase Storage
 *
 * @param {string} filePath - Storage path to the PDF
 * @returns {Promise<boolean>} Success status
 */
async function deletePDF(filePath) {
  const supabase = getDatabase();

  const { error } = await supabase.storage
    .from('client-reports')
    .remove([filePath]);

  if (error) {
    console.error('❌ Error deleting PDF from storage:', error);
    throw new Error(`Failed to delete PDF: ${error.message}`);
  }

  console.log(`🗑️  PDF deleted from storage: ${filePath}`);

  return true;
}

/**
 * List all reports for a client
 *
 * @param {string} clientId - Client UUID
 * @param {string} reportType - Optional filter by report type
 * @returns {Promise<Array>} Array of file metadata
 */
async function listClientReports(clientId, reportType = null) {
  const supabase = getDatabase();

  // List files in client folder
  const prefix = reportType ? `${clientId}/${reportType}/` : `${clientId}/`;

  const { data, error } = await supabase.storage
    .from('client-reports')
    .list(prefix, {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' }
    });

  if (error) {
    console.error('❌ Error listing client reports:', error);
    throw new Error(`Failed to list reports: ${error.message}`);
  }

  return data || [];
}

/**
 * Get public URL for a file (requires bucket to be public)
 * Note: For private buckets, use getSignedURL instead
 *
 * @param {string} filePath - Storage path to the PDF
 * @returns {string} Public URL
 */
function getPublicURL(filePath) {
  const supabase = getDatabase();

  const { data } = supabase.storage
    .from('client-reports')
    .getPublicUrl(filePath);

  return data.publicUrl;
}

/**
 * Download PDF buffer from storage (for server-side operations)
 *
 * @param {string} filePath - Storage path to the PDF
 * @returns {Promise<Buffer>} PDF file buffer
 */
async function downloadPDF(filePath) {
  const supabase = getDatabase();

  const { data, error } = await supabase.storage
    .from('client-reports')
    .download(filePath);

  if (error) {
    console.error('❌ Error downloading PDF from storage:', error);
    throw new Error(`Failed to download PDF: ${error.message}`);
  }

  // Convert Blob to Buffer
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  uploadPDF,
  getSignedURL,
  deletePDF,
  listClientReports,
  getPublicURL,
  downloadPDF
};
