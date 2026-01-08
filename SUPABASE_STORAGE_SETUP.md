# Supabase Storage Setup for Document Uploads

## Step 1: Create Storage Bucket

1. Go to your Supabase Dashboard: https://app.supabase.com/project/yldplemkwihvnvymllni
2. Navigate to **Storage** in the left sidebar
3. Click **New Bucket**
4. Configure the bucket:
   - **Name**: `client-statements`
   - **Public bucket**: NO (keep it private)
   - **File size limit**: 10 MB (10485760 bytes)
   - **Allowed MIME types**: `application/pdf,image/jpeg,image/jpg,image/png,text/csv`
   - Click **Create bucket**

## Step 2: Set Up Storage Policies

After creating the bucket, set up Row Level Security policies:

### Policy 1: Clients Can Upload to Their Own Folder

```sql
CREATE POLICY "Clients can upload to own folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'client-statements'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

### Policy 2: Clients Can View Their Own Files

```sql
CREATE POLICY "Clients can view own files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'client-statements'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

### Policy 3: Clients Can Delete Their Own Files

```sql
CREATE POLICY "Clients can delete own files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'client-statements'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

### Policy 4: Admins/Advisors Can View All Files

```sql
CREATE POLICY "Admins can view all files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'client-statements'
  AND EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND (auth.users.raw_user_meta_data->>'role' = 'admin'
         OR auth.users.raw_user_meta_data->>'role' = 'advisor')
  )
);
```

### Policy 5: Admins/Advisors Can Download All Files

```sql
CREATE POLICY "Admins can download all files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'client-statements'
  AND EXISTS (
    SELECT 1 FROM auth.users
    WHERE auth.users.id = auth.uid()
    AND (auth.users.raw_user_meta_data->>'role' = 'admin'
         OR auth.users.raw_user_meta_data->>'role' = 'advisor')
  )
);
```

## Step 3: Folder Structure

Files will be organized as:
```
/client-statements/
  /{clientId}/
    /{YYYY-MM}/
      /{filename}
```

Example:
```
/client-statements/550e8400-e29b-41d4-a716-446655440000/2024-12/chase_checking_dec2024.pdf
```

## Step 4: File Naming Convention

Files should be named with pattern:
```
{institution}_{account_type}_{month}{year}.{extension}
```

Examples:
- `chase_checking_dec2024.pdf`
- `amex_credit_card_nov2024.pdf`
- `vanguard_investment_oct2024.csv`

## Step 5: Verify Setup

To verify the bucket is set up correctly:

1. Go to Storage > client-statements
2. Check that policies are enabled
3. Try uploading a test file through the Supabase dashboard
4. Verify RLS policies are working

## Step 6: Apply Database Migration

Run the documents table migration:

```bash
cd backend
psql $DATABASE_URL -f migrations/003_documents_table.sql
```

Or through Supabase SQL Editor:
1. Go to SQL Editor in Supabase Dashboard
2. Copy contents of `migrations/003_documents_table.sql`
3. Paste and run

## Environment Variables

Make sure these are set:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (for backend)
- `REACT_APP_SUPABASE_URL` - Same URL (for frontend)
- `REACT_APP_SUPABASE_ANON_KEY` - Anon key (for frontend)
