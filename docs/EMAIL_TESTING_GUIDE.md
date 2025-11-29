# 📧 Email Testing Guide

This guide walks you through setting up and testing email functionality in InvoiceMe.

## Table of Contents

1. [Development Setup](#development-setup)
2. [Testing Email Functionality](#testing-email-functionality)
3. [Production Setup](#production-setup)
4. [Troubleshooting](#troubleshooting)

---

## Development Setup

### Option 1: Mailtrap (Recommended)

**Mailtrap** is the recommended service for development email testing. It provides a safe environment to test emails without risk of sending to real users.

#### Step 1: Sign Up for Mailtrap

1. Visit [https://mailtrap.io](https://mailtrap.io)
2. Sign up for a free account (no credit card required)
3. Free tier includes 500 emails/month

#### Step 2: Create an Inbox

1. After signing in, click "Add Inbox"
2. Name it "InvoiceMe Development"
3. Select the inbox to view its settings

#### Step 3: Get SMTP Credentials

1. Go to inbox settings
2. Click on "SMTP Settings" tab
3. Select "SMTP" option (not API)
4. Copy the following credentials:
   - **Host**: `sandbox.smtp.mailtrap.io`
   - **Port**: `2525`
   - **Username**: (your Mailtrap username)
   - **Password**: (your Mailtrap password)

#### Step 4: Configure Backend

1. Navigate to `backend/` directory
2. Copy `.env.example` to `.env` if you haven't already:
   ```bash
   cp env.example .env
   ```

3. Edit `backend/.env` and add/update the email configuration:
   ```env
   # Mailtrap Configuration
   SMTP_HOST=sandbox.smtp.mailtrap.io
   SMTP_PORT=2525
   SMTP_USER=your-mailtrap-username
   SMTP_PASS=your-mailtrap-password
   EMAIL_FROM=noreply@invoiceme.com
   FRONTEND_URL=http://localhost:8080
   SUPPORT_EMAIL=support@invoiceme.com
   ```

4. Save the file

#### Step 5: Verify Configuration

Run the email test script:
```bash
cd backend
npm run test:email
```

Or manually verify using the health endpoint:
```bash
curl http://localhost:3000/api/health
```

Check the backend logs for SMTP initialization:
```
[EmailService] Email service initialized with SMTP host: sandbox.smtp.mailtrap.io:2525
```

---

### Option 2: Ethereal Email (Quick Testing)

**Ethereal Email** provides instant email accounts for testing without signup.

#### Step 1: Generate Account

1. Visit [https://ethereal.email](https://ethereal.email)
2. Click "Create Ethereal Account"
3. No signup required - generates instantly
4. Copy the SMTP credentials displayed

#### Step 2: Configure Backend

Edit `backend/.env`:
```env
# Ethereal Email Configuration
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=your-ethereal-username
SMTP_PASS=your-ethereal-password
EMAIL_FROM=noreply@invoiceme.com
FRONTEND_URL=http://localhost:8080
SUPPORT_EMAIL=support@invoiceme.com
```

#### Step 3: View Emails

- Click the provided URL in the Ethereal account page to view received emails
- Emails are stored temporarily (typically 24 hours)

**Note:** For long-term development, Mailtrap is recommended as it provides persistent inboxes.

---

## Testing Email Functionality

### Test 1: Verify SMTP Connection

**Method 1: Using Test Script**

```bash
cd backend
npm run test:email
```

**Method 2: Using Health Endpoint**

```bash
curl http://localhost:3000/api/health
```

Look for email status in the response (if email verification is enabled).

**Method 3: Check Backend Logs**

Start your backend and look for:
```
[EmailService] Email service initialized with SMTP host: ...
```

If SMTP is not configured, you'll see:
```
[EmailService] SMTP_HOST not configured. Email sending will be disabled.
```

---

### Test 2: Password Reset Email

#### Step 1: Start Backend

```bash
cd backend
npm run start:dev
```

#### Step 2: Request Password Reset

**Using cURL:**
```bash
curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

**Using Frontend:**
1. Navigate to the password reset page
2. Enter an email address
3. Submit the form

#### Step 3: Check Email Inbox

**Mailtrap:**
1. Go to your Mailtrap inbox
2. You should see the password reset email
3. Click on it to view the full email

**Ethereal:**
1. Click the URL provided when you created the account
2. View the received email

#### Step 4: Verify Email Content

Check that the email contains:
- ✅ Subject: "Reset Your Password - InvoiceMe"
- ✅ Reset link/button
- ✅ Reset token in the URL
- ✅ Proper styling
- ✅ Frontend URL in the reset link

#### Step 5: Test Reset Link

1. Copy the reset link from the email
2. Open it in a browser
3. Verify it redirects to: `http://localhost:8080/reset-password?token=...`
4. Verify the token is present in the URL

---

### Test 3: Invoice Email

#### Prerequisites

1. You need a user account (register or use existing)
2. You need at least one client
3. You need at least one invoice

#### Step 1: Create Test Invoice

**Using API:**
```bash
# First, get your auth token
TOKEN="your-jwt-token-here"

# Create a client (if you don't have one)
curl -X POST http://localhost:3000/api/v1/clients \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Client",
    "email": "client@example.com"
  }'

# Create an invoice
curl -X POST http://localhost:3000/api/v1/invoices \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "client-id-here",
    "type": "invoice",
    "items": [
      {
        "description": "Test Item",
        "quantity": 1,
        "unitPrice": 100.00
      }
    ],
    "currency": "USD"
  }'
```

#### Step 2: Send Invoice Email

**Using API:**
```bash
# Replace INVOICE_ID with the ID from step 1
curl -X POST http://localhost:3000/api/v1/invoices/INVOICE_ID/send \
  -H "Authorization: Bearer $TOKEN"
```

**Using Frontend:**
1. Navigate to the invoice detail page
2. Click "Send Invoice" button

#### Step 3: Check Email Inbox

1. Go to your Mailtrap/Ethereal inbox
2. You should see the invoice email
3. Click on it to view the full email

#### Step 4: Verify Email Content

Check that the email contains:
- ✅ Subject: "Invoice #INV-XXX from YourCompany"
- ✅ Invoice number
- ✅ Total amount and currency
- ✅ Due date (if set)
- ✅ "View Invoice" button/link
- ✅ "Download PDF" button/link (if PDF was generated)
- ✅ Support email in footer
- ✅ Proper styling

#### Step 5: Test Links

1. **View Invoice Link:**
   - Click "View Invoice" button
   - Verify it redirects to: `http://localhost:8080/invoices/INVOICE_NUMBER`
   - Verify the invoice displays correctly

2. **Download PDF Link:**
   - Click "Download PDF" button
   - Verify PDF downloads
   - Verify PDF content is correct

---

## Production Setup

### Step 1: Choose Email Service

**Recommended: SendGrid**
- Generous free tier (100 emails/day)
- Excellent deliverability
- Easy domain verification
- Good documentation

**Alternatives:**
- **Mailgun**: Good for high-volume sending
- **AWS SES**: Cost-effective for AWS users
- **Postmark**: Excellent deliverability for transactional emails

### Step 2: Set Up SendGrid

#### 2.1: Sign Up

1. Visit [https://sendgrid.com](https://sendgrid.com)
2. Create an account
3. Verify your email address

#### 2.2: Verify Sender

**Option A: Single Sender Verification (Quick Start)**
1. Go to Settings → Sender Authentication
2. Click "Verify a Single Sender"
3. Fill in the form
4. Verify the email address

**Option B: Domain Authentication (Recommended for Production)**
1. Go to Settings → Sender Authentication
2. Click "Authenticate Your Domain"
3. Follow the setup wizard
4. Add DNS records to your domain

#### 2.3: Create API Key

1. Go to Settings → API Keys
2. Click "Create API Key"
3. Name it "InvoiceMe Production"
4. Select "Full Access" or "Mail Send" permissions
5. **Copy the API key immediately** (shown only once)

#### 2.4: Configure Production Environment

Edit your production `.env` file (use `.env.production.example` as template):

```env
# SendGrid Configuration
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key-here
EMAIL_FROM=noreply@yourdomain.com
FRONTEND_URL=https://app.yourdomain.com
SUPPORT_EMAIL=support@yourdomain.com
```

### Step 3: Configure DNS Records

For domain authentication, add these DNS records:

#### SPF Record

```
Type: TXT
Name: @ (or your domain)
Value: v=spf1 include:sendgrid.net ~all
TTL: 3600
```

#### DKIM Records

SendGrid will provide these in the domain authentication setup:
- Multiple TXT records with selectors (e.g., `s1._domainkey`, `s2._domainkey`)
- Add all records provided by SendGrid

#### DMARC Record

```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com
TTL: 3600
```

**Note:** Start with `p=none` for monitoring, then gradually move to `p=quarantine` and `p=reject`.

### Step 4: Verify DNS Records

1. Wait for DNS propagation (typically 1-24 hours)
2. Use online tools to verify:
   - [MXToolbox SPF Checker](https://mxtoolbox.com/spf.aspx)
   - [MXToolbox DMARC Checker](https://mxtoolbox.com/dmarc.aspx)
3. Check SendGrid dashboard for verification status

### Step 5: Test Production Email

1. Deploy your backend with production environment variables
2. Test password reset email
3. Test invoice email
4. Check spam folder initially (emails may go to spam until domain reputation is established)
5. Monitor SendGrid dashboard for:
   - Delivery statistics
   - Bounce rates
   - Spam complaints

---

## Troubleshooting

### SMTP Connection Failed

**Error:** `Connection refused` or `ECONNREFUSED`

**Solutions:**
- Verify `SMTP_HOST` and `SMTP_PORT` in `.env`
- Check firewall allows outbound SMTP (port 587/465)
- Test SMTP connection with telnet:
  ```bash
  telnet smtp.sendgrid.net 587
  ```
- Try alternative port (587 vs 465)

### Authentication Failed

**Error:** `Invalid login` or `Authentication failed`

**Solutions:**
- Verify `SMTP_USER` and `SMTP_PASS` in `.env`
- For SendGrid, ensure `SMTP_USER=apikey` (literal string)
- Regenerate API key in email service dashboard
- Check account status in email service dashboard

### Emails Not Received

**Symptoms:** Emails sent but not appearing in inbox

**Solutions:**
- Check spam/junk folder
- Verify email address is correct
- Check email service dashboard for bounces
- Review email service logs for delivery status
- Wait and retry (rate limits may apply)

### Emails Going to Spam

**Solutions:**
- Verify domain in email service provider
- Add SPF, DKIM, DMARC DNS records
- Use verified email address in `EMAIL_FROM`
- Wait for DNS propagation (up to 24 hours)
- Monitor domain reputation
- Avoid spam trigger words in email content

### Template Not Found

**Error:** `Email template not found`

**Solutions:**
- Verify template files exist: `password-reset.html`, `invoice-email.html`
- Check file paths in email service code
- Ensure templates are copied during build
- Check file permissions

### SMTP Not Configured Warning

**Warning:** `SMTP_HOST not configured. Email sending will be disabled.`

**Solutions:**
- Add `SMTP_HOST` to your `.env` file
- Restart backend after updating `.env`
- Verify environment variables are loaded correctly

---

## Quick Reference

### Environment Variables

```env
# Required for email sending
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-api-key
EMAIL_FROM=noreply@yourdomain.com

# Required for email links
FRONTEND_URL=https://app.yourdomain.com

# Required for email footers
SUPPORT_EMAIL=support@yourdomain.com
```

### API Endpoints

- **Password Reset Request:** `POST /api/v1/auth/password-reset-request`
- **Send Invoice:** `POST /api/v1/invoices/:id/send`
- **Health Check:** `GET /api/health`

### Test Commands

```bash
# Test email configuration
npm run test:email

# Check health
curl http://localhost:3000/api/health

# Request password reset
curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

---

## Next Steps

After testing:

1. ✅ Verify all emails are received correctly
2. ✅ Test all links in emails
3. ✅ Verify email styling renders correctly
4. ✅ Set up production email service
5. ✅ Configure DNS records
6. ✅ Test production emails
7. ✅ Monitor email delivery statistics

For more details, see [DEPLOYMENT.md](../DEPLOYMENT.md#email-smtp-configuration).

