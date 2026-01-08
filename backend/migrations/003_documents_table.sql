-- Create documents table for client statement uploads
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL, -- Supabase Storage path
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'jpg', 'jpeg', 'png', 'csv')),
  file_size INTEGER NOT NULL, -- in bytes
  account_type TEXT NOT NULL CHECK (account_type IN ('bank_statement', 'credit_card', 'investment', 'loan', 'other')),
  statement_date DATE NOT NULL, -- which month/year this statement is for
  upload_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'approved', 'rejected')),
  ocr_data JSONB, -- extracted data from OCR
  notes TEXT,
  rejected_reason TEXT, -- if rejected, why?
  processed_by UUID REFERENCES auth.users(id), -- admin who processed it
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_documents_client_id ON documents(client_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_statement_date ON documents(statement_date);
CREATE INDEX idx_documents_upload_date ON documents(upload_date DESC);

-- Enable Row Level Security
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

-- Policy: Clients can view their own documents
CREATE POLICY "Clients can view own documents"
  ON documents
  FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

-- Policy: Clients can insert their own documents
CREATE POLICY "Clients can upload own documents"
  ON documents
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid());

-- Policy: Admins/advisors can view all documents
CREATE POLICY "Admins can view all documents"
  ON documents
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_user_meta_data->>'role' = 'admin'
           OR auth.users.raw_user_meta_data->>'role' = 'advisor')
    )
  );

-- Policy: Admins/advisors can update documents (for OCR processing and approval)
CREATE POLICY "Admins can update documents"
  ON documents
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_user_meta_data->>'role' = 'admin'
           OR auth.users.raw_user_meta_data->>'role' = 'advisor')
    )
  );

-- Policy: Admins/advisors can delete documents
CREATE POLICY "Admins can delete documents"
  ON documents
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND (auth.users.raw_user_meta_data->>'role' = 'admin'
           OR auth.users.raw_user_meta_data->>'role' = 'advisor')
    )
  );

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_documents_updated_at();

-- Grant permissions
GRANT ALL ON documents TO authenticated;
GRANT ALL ON documents TO service_role;
