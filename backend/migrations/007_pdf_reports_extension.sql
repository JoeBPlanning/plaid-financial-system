-- ================================================
-- Documents Table Extension for PDF Reports
-- ================================================
-- Purpose: Extend the existing documents table to support generated PDF reports
-- Created: 2025-01-04

-- Add columns for generated PDF reports
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS document_category TEXT DEFAULT 'uploaded';

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS report_type TEXT;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS report_period_start DATE;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS report_period_end DATE;

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS generation_params JSONB;

-- Add comments for new columns
COMMENT ON COLUMN documents.document_category IS 'Category of document: uploaded (user uploaded) or generated (system generated report)';
COMMENT ON COLUMN documents.report_type IS 'Type of generated report: monthly_cash_flow, net_worth, annual_summary, or retirement_projection';
COMMENT ON COLUMN documents.report_period_start IS 'Start date of the reporting period for generated reports';
COMMENT ON COLUMN documents.report_period_end IS 'End date of the reporting period for generated reports';
COMMENT ON COLUMN documents.generation_params IS 'JSON parameters used to generate the report (e.g., {"month": "2025-01", "includeSocialSecurity": true})';

-- Add constraint to validate report types
ALTER TABLE documents
ADD CONSTRAINT valid_report_type
  CHECK (
    report_type IS NULL OR
    report_type IN ('monthly_cash_flow', 'net_worth', 'annual_summary', 'retirement_projection')
  );

-- Add constraint to validate document category
ALTER TABLE documents
ADD CONSTRAINT valid_document_category
  CHECK (
    document_category IN ('uploaded', 'generated')
  );

-- Create index for faster filtering by report type
CREATE INDEX IF NOT EXISTS idx_documents_report_type ON documents(report_type) WHERE report_type IS NOT NULL;

-- Create index for faster filtering by document category
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(document_category);

-- Create index for faster filtering by report period
CREATE INDEX IF NOT EXISTS idx_documents_report_period ON documents(report_period_start, report_period_end)
WHERE document_category = 'generated';

-- ================================================
-- Update existing RLS policies if needed
-- ================================================
-- The existing RLS policies on the documents table should already cover:
-- 1. Clients can view their own documents (both uploaded and generated)
-- 2. Advisors can view all documents
--
-- No additional policies are needed for the new columns

-- ================================================
-- Notes on Usage
-- ================================================
-- For uploaded documents (existing functionality):
--   document_category = 'uploaded'
--   report_type = NULL
--   status = 'pending', 'processing', 'processed', 'approved', 'rejected'
--
-- For generated reports (new functionality):
--   document_category = 'generated'
--   report_type = 'monthly_cash_flow' | 'net_worth' | 'annual_summary' | 'retirement_projection'
--   status = 'approved' (auto-approved since system generated)
--   report_period_start/end = date range for the report
--   generation_params = JSON with parameters like {"month": "2025-01", "emailToClient": true}
