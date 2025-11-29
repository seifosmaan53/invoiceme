# Phase 3 - Attachments & PDF: Complete

## Overview

Phase 3 implements file attachments and PDF generation with HTML templates using Puppeteer. All files are stored in S3-compatible storage and URLs are saved in the database.

## ✅ Completed Components

### 1. S3 Service Enhancement

**Location:** `backend/src/core/services/s3.service.ts`

**Features:**
- ✅ Upload files to S3 with public access
- ✅ Get public URL for uploaded files
- ✅ Generate pre-signed URLs for temporary access
- ✅ Delete files from S3
- ✅ Supports both local MinIO and AWS S3

**Methods:**
- `uploadFile(key, buffer, contentType)` - Upload file and return public URL
- `getPublicUrl(key)` - Get public URL for a file
- `getSignedUrl(key, expiresIn)` - Get pre-signed URL for temporary access
- `deleteFile(key)` - Delete file from S3

**URL Format:**
- Local/MinIO: `http://localhost:9000/bucket-name/path/to/file`
- AWS S3: `https://bucket-name.s3.region.amazonaws.com/path/to/file`

### 2. Attachment Upload Endpoint

**POST /v1/invoices/:id/attachments**

Upload an image or PDF attachment to an invoice.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: `file` (file field)

**Supported File Types:**
- Images: JPEG, PNG, GIF
- Documents: PDF

**Response (201 Created):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174008",
  "ownerType": "invoice",
  "ownerId": "123e4567-e89b-12d3-a456-426614174003",
  "url": "https://s3.example.com/bucket/invoices/.../attachment.pdf",
  "filename": "invoice.pdf",
  "contentType": "application/pdf",
  "sizeBytes": 12345,
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

**Features:**
- Validates file type (images and PDFs only)
- Uploads to S3 under `invoices/{invoiceId}/attachments/`
- Saves attachment metadata in database
- Returns attachment record with S3 URL

**Error Responses:**
- `400 Bad Request`: No file uploaded or invalid file type
- `404 Not Found`: Invoice not found
- `403 Forbidden`: User doesn't own invoice

### 3. HTML Invoice Template

**Location:** `backend/src/core/templates/invoice.html`

**Features:**
- Professional, modern design
- Responsive layout
- Print-friendly styling
- Includes:
  - Header with InvoiceMe branding
  - Invoice number and status badge
  - Issue date and due date
  - Bill To section with client information
  - Invoice details section
  - Items table with optional tax/discount columns
  - Totals section (subtotal, discount, tax, total)
  - Notes section
  - Footer

**Template Variables:**
- `{{invoiceNumber}}` - Invoice/Estimate number
- `{{invoiceType}}` - "Invoice" or "Estimate"
- `{{issueDate}}` - Formatted issue date
- `{{dueDate}}` - Formatted due date (optional)
- `{{status}}` - Invoice status
- `{{currency}}` - Currency code
- `{{companyName}}` - User's company name
- `{{clientName}}` - Client name
- `{{clientEmail}}` - Client email
- `{{clientPhone}}` - Client phone
- `{{clientAddress}}` - Formatted client address
- `{{items}}` - Array of invoice items
- `{{subtotal}}` - Formatted subtotal
- `{{taxTotal}}` - Formatted tax total
- `{{discountTotal}}` - Formatted discount total
- `{{total}}` - Formatted grand total
- `{{notes}}` - Invoice notes

**Styling:**
- Clean, professional design
- Blue accent color (#4a90e2)
- Proper spacing and typography
- Print media queries for PDF generation

### 4. PDF Generation Service (Puppeteer)

**Location:** `backend/src/core/services/pdf.service.ts`

**Features:**
- ✅ Uses Puppeteer to render HTML to PDF
- ✅ Loads HTML template from file system
- ✅ Falls back to inline template if file not found
- ✅ Handles both structured and flat data formats
- ✅ Formats dates, currency, and addresses
- ✅ Escapes HTML entities for security
- ✅ Generates A4 format PDFs with proper margins

**Methods:**
- `generateInvoicePdf(data)` - Generate PDF buffer from invoice data

**PDF Configuration:**
- Format: A4
- Margins: 20mm on all sides
- Print background: Enabled
- Quality: High resolution

**Template Processing:**
- Replaces template variables with actual data
- Handles conditional sections (due date, notes, tax/discount columns)
- Formats currency using Intl.NumberFormat
- Formats dates in readable format
- Processes item arrays dynamically

### 5. PDF Generation Endpoint

**POST /v1/invoices/:id/pdf**

Generate PDF for an invoice and upload to S3.

**Request:**
- Method: `POST`
- Path: `/v1/invoices/:id/pdf`
- Authentication: Required (Bearer token)

**Response (200 OK):**
```json
{
  "url": "https://s3.example.com/bucket/pdfs/.../INV-2024-0001.pdf",
  "invoiceId": "123e4567-e89b-12d3-a456-426614174003"
}
```

**Process:**
1. Fetch invoice with client and items
2. Render HTML template with invoice data
3. Generate PDF using Puppeteer
4. Upload PDF to S3 under `pdfs/{invoiceId}/{invoiceNumber}.pdf`
5. Return public URL

**Features:**
- Generates professional PDF invoices
- Uploads to S3 for permanent storage
- Returns public URL for download/sharing
- Works for both invoices and estimates

**Error Responses:**
- `404 Not Found`: Invoice not found
- `403 Forbidden`: User doesn't own invoice

## File Storage Structure

```
S3 Bucket:
├── invoices/
│   └── {invoiceId}/
│       └── attachments/
│           └── {timestamp}-{filename}
└── pdfs/
    └── {invoiceId}/
        └── {invoiceNumber}.pdf
```

## Installation

Install Puppeteer dependency:

```bash
cd backend
npm install puppeteer
```

## Configuration

Ensure S3 environment variables are set:

```env
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_BUCKET=invoiceme
```

## Testing

### Upload Attachment

```bash
curl -X POST \
  http://localhost:3000/api/v1/invoices/{invoiceId}/attachments \
  -H "Authorization: Bearer {token}" \
  -F "file=@/path/to/file.pdf"
```

### Generate PDF

```bash
curl -X POST \
  http://localhost:3000/api/v1/invoices/{invoiceId}/pdf \
  -H "Authorization: Bearer {token}"
```

## Template Customization

The HTML template can be customized by editing:
- `backend/src/core/templates/invoice.html`

Changes will be automatically included in PDF generation. The template uses inline CSS for maximum compatibility with Puppeteer.

## Puppeteer Configuration

The PDF service launches Puppeteer with:
- Headless mode: Enabled
- Security flags: `--no-sandbox`, `--disable-setuid-sandbox` (for Docker/CI environments)

## Phase 3 Checklist

- ✅ S3 service with upload, get URL, delete methods
- ✅ POST /v1/invoices/:id/attachments endpoint
- ✅ HTML invoice template
- ✅ PDF generator using Puppeteer
- ✅ POST /v1/invoices/:id/pdf endpoint
- ✅ File validation (file type checking)
- ✅ Error handling
- ✅ Swagger documentation

## Next Steps

Phase 3 is complete. Ready for:
- Phase 4: Payment Integration
- Phase 5: Mobile Sync
- Phase 6: Email Notifications

All attachment and PDF functionality is implemented and ready for use.

