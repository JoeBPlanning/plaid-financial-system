# OCR Integration Guide

## Overview

This guide explains how to integrate your Python OCR script with the document upload system. The backend has placeholder code that needs to be connected to your actual OCR processing script.

## Python OCR Script Requirements

### Script Location
Create your OCR script at: `backend/scripts/ocr_processor.py`

### Script Interface

Your Python script should:
1. Accept a file path as a command-line argument
2. Download the file from Supabase Storage
3. Process the document with OCR
4. Output JSON to stdout
5. Exit with code 0 on success, non-zero on failure

### Example Python Script Template

```python
#!/usr/bin/env python3
import sys
import json
import os
from supabase import create_client, Client
from datetime import datetime

# Initialize Supabase client
supabase_url = os.environ.get('SUPABASE_URL')
supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
supabase: Client = create_client(supabase_url, supabase_key)

def process_document(file_path):
    """
    Download and process document from Supabase Storage

    Args:
        file_path: Path in Supabase Storage (e.g., "client-id/2024-12/statement.pdf")

    Returns:
        dict: OCR results in standard format
    """
    try:
        # Download file from Supabase Storage
        response = supabase.storage.from_('client-statements').download(file_path)

        # Save to temporary file
        temp_file = f"/tmp/{os.path.basename(file_path)}"
        with open(temp_file, 'wb') as f:
            f.write(response)

        # TODO: Replace with your actual OCR logic
        # This could use Tesseract, AWS Textract, Google Vision API, etc.
        ocr_results = perform_ocr(temp_file)

        # Clean up temp file
        os.remove(temp_file)

        # Format results
        return format_ocr_results(ocr_results, file_path)

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

def perform_ocr(file_path):
    """
    Perform OCR on the document
    Replace this with your actual OCR implementation
    """
    # Example using pytesseract:
    # from PIL import Image
    # import pytesseract
    #
    # if file_path.endswith('.pdf'):
    #     # Convert PDF to images and OCR each page
    #     from pdf2image import convert_from_path
    #     images = convert_from_path(file_path)
    #     text = ""
    #     for image in images:
    #         text += pytesseract.image_to_string(image)
    # else:
    #     # OCR image directly
    #     image = Image.open(file_path)
    #     text = pytesseract.image_to_string(image)

    # For now, return mock data
    return {
        "raw_text": "Sample extracted text...",
        "confidence": 0.92,
        "detected_accounts": [
            {
                "name": "Checking Account",
                "number": "****1234",
                "balance": 5420.50,
                "date": "2024-12-30"
            }
        ]
    }

def format_ocr_results(ocr_results, file_path):
    """
    Format OCR results into the expected JSON structure
    """
    return {
        "documentId": None,  # Will be set by backend
        "extractedDate": datetime.now().isoformat(),
        "confidence": ocr_results.get("confidence", 0.0),
        "accounts": [
            {
                "accountName": acc["name"],
                "accountNumber": acc["number"],
                "accountType": "checking",  # Infer from statement type
                "balance": acc["balance"],
                "asOfDate": acc["date"],
                "currency": "USD"
            }
            for acc in ocr_results.get("detected_accounts", [])
        ],
        "transactions": [],  # If you extract transaction data
        "rawText": ocr_results.get("raw_text", "")
    }

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: ocr_processor.py <file_path>", file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    result = process_document(file_path)

    # Output JSON to stdout
    print(json.dumps(result, indent=2))
    sys.exit(0)
```

## Backend Integration

### Uncomment OCR Processing Code

In `backend/server.js`, find the `/api/admin/statements/:documentId/process-ocr` endpoint (around line 1090) and uncomment/modify the Python execution code:

```javascript
// Update status to processing
const { error: updateError } = await supabase
  .from('documents')
  .update({ status: 'processing' })
  .eq('id', documentId);

if (updateError) {
  console.error('Error updating document status:', updateError);
  return res.status(500).json({ error: 'Failed to update document status' });
}

// Call Python OCR script
const { spawn } = require('child_process');
const pythonProcess = spawn('python3', [
  'scripts/ocr_processor.py',
  document.file_path
]);

let ocrDataBuffer = '';
let errorBuffer = '';

pythonProcess.stdout.on('data', (data) => {
  ocrDataBuffer += data.toString();
});

pythonProcess.stderr.on('data', (data) => {
  errorBuffer += data.toString();
  console.error('OCR stderr:', data.toString());
});

pythonProcess.on('close', async (code) => {
  if (code === 0) {
    try {
      const ocrData = JSON.parse(ocrDataBuffer);
      ocrData.documentId = documentId;

      // Update document with OCR data
      await supabase
        .from('documents')
        .update({
          ocr_data: ocrData,
          status: 'processed',
          processed_at: new Date().toISOString(),
          processed_by: req.user.clientId
        })
        .eq('id', documentId);

      console.log(`OCR processing completed for document ${documentId}`);
    } catch (err) {
      console.error('Error parsing OCR output:', err);
      await supabase
        .from('documents')
        .update({
          status: 'pending',
          notes: `OCR failed: ${err.message}`
        })
        .eq('id', documentId);
    }
  } else {
    console.error(`OCR process exited with code ${code}`);
    await supabase
      .from('documents')
      .update({
        status: 'pending',
        notes: `OCR failed with exit code ${code}: ${errorBuffer}`
      })
      .eq('id', documentId);
  }
});

logSecurityEvent('ocr_processing_started', req.user.clientId, req.ip, {
  documentId,
  filename: document.filename
});

res.json({
  success: true,
  message: 'OCR processing started',
  documentId
});
```

## OCR Data Format Specification

### Standard JSON Output Format

```json
{
  "documentId": "uuid-here",
  "extractedDate": "2024-12-30T10:30:00Z",
  "confidence": 0.92,
  "accounts": [
    {
      "accountName": "Chase Total Checking",
      "accountNumber": "****1234",
      "accountType": "checking",
      "balance": 5420.50,
      "asOfDate": "2024-12-30",
      "currency": "USD"
    },
    {
      "accountName": "Savings Account",
      "accountNumber": "****5678",
      "accountType": "savings",
      "balance": 12350.75,
      "asOfDate": "2024-12-30",
      "currency": "USD"
    }
  ],
  "transactions": [
    {
      "date": "2024-12-15",
      "description": "Amazon Purchase",
      "amount": -45.23,
      "category": "shopping"
    },
    {
      "date": "2024-12-20",
      "description": "Paycheck Deposit",
      "amount": 3500.00,
      "category": "income"
    }
  ],
  "rawText": "Full OCR text extraction for debugging and review..."
}
```

### Field Descriptions

- **documentId**: UUID of the document (will be set by backend)
- **extractedDate**: ISO timestamp when OCR was performed
- **confidence**: OCR confidence score (0.0 to 1.0)
- **accounts**: Array of account information extracted
  - **accountName**: Full name of the account
  - **accountNumber**: Last 4 digits or masked account number
  - **accountType**: checking, savings, credit_card, investment, loan
  - **balance**: Current balance as decimal number
  - **asOfDate**: Date the balance is effective (YYYY-MM-DD)
  - **currency**: Currency code (default: USD)
- **transactions**: Optional array of transactions (if extracting from statement)
  - **date**: Transaction date (YYYY-MM-DD)
  - **description**: Transaction description
  - **amount**: Amount (negative for debits, positive for credits)
  - **category**: Optional category classification
- **rawText**: Full text extracted from document (for debugging)

## Environment Setup

### Required Python Packages

```bash
pip install supabase python-dotenv pytesseract pdf2image pillow
```

### System Dependencies

For PDF processing:
```bash
# macOS
brew install tesseract poppler

# Ubuntu/Debian
sudo apt-get install tesseract-ocr poppler-utils

# For better accuracy, install language data
brew install tesseract-lang  # macOS
```

### Environment Variables

Ensure these are set in your backend environment:

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Testing OCR Integration

### Test Script Standalone

```bash
cd backend
export SUPABASE_URL=your_url
export SUPABASE_SERVICE_ROLE_KEY=your_key

python3 scripts/ocr_processor.py "client-id/2024-12/test.pdf"
```

### Expected Output

```json
{
  "documentId": null,
  "extractedDate": "2024-12-30T15:30:00.000000",
  "confidence": 0.92,
  "accounts": [...],
  "transactions": [...],
  "rawText": "..."
}
```

## Advanced OCR Options

### Using Cloud OCR Services

#### AWS Textract

```python
import boto3

textract = boto3.client('textract')
response = textract.analyze_document(
    Document={'Bytes': file_bytes},
    FeatureTypes=['TABLES', 'FORMS']
)
```

#### Google Cloud Vision API

```python
from google.cloud import vision

client = vision.ImageAnnotatorClient()
response = client.document_text_detection(image=image)
```

#### Azure Form Recognizer

```python
from azure.ai.formrecognizer import DocumentAnalysisClient

client = DocumentAnalysisClient(endpoint, credential)
poller = client.begin_analyze_document("prebuilt-document", document)
```

## Monitoring & Logging

### Log Files

The OCR script should log to:
- Stdout: JSON results
- Stderr: Error messages and debugging info

### Debugging

To debug OCR processing:

1. Check backend logs for Python process errors
2. Review the `rawText` field in OCR output
3. Check document status and notes in database
4. Test OCR script independently with sample files

## Production Considerations

1. **Queue System**: For production, consider using a job queue (Bull, AWS SQS) to process OCR jobs asynchronously
2. **Retry Logic**: Implement retries for failed OCR attempts
3. **Rate Limiting**: Respect API limits if using cloud OCR services
4. **Cost**: Monitor OCR API usage and costs
5. **Security**: Ensure documents are processed securely and deleted after OCR
6. **Notification**: Consider notifying admin when OCR is complete

## Next Steps

1. Implement your OCR logic in `backend/scripts/ocr_processor.py`
2. Test with sample documents
3. Uncomment the integration code in `server.js`
4. Deploy and test end-to-end
5. Set up monitoring and alerts
