# ✅ Email Setup Checklist

Use this checklist to set up and test email functionality.

## Development Setup

### Step 1: Choose Development Email Service

- [ ] **Option A: Mailtrap** (Recommended)
  - [ ] Sign up at https://mailtrap.io
  - [ ] Create inbox "InvoiceMe Development"
  - [ ] Copy SMTP credentials from inbox settings

- [ ] **Option B: Ethereal Email** (Quick testing)
  - [ ] Visit https://ethereal.email
  - [ ] Click "Create Ethereal Account"
  - [ ] Copy SMTP credentials

### Step 2: Configure Backend Environment

- [ ] Copy `backend/env.example` to `backend/.env`
- [ ] Add email configuration to `backend/.env`:
  ```env
  SMTP_HOST=sandbox.smtp.mailtrap.io  # or smtp.ethereal.email
  SMTP_PORT=2525                       # or 587 for Ethereal
  SMTP_USER=your-username
  SMTP_PASS=your-password
  EMAIL_FROM=noreply@invoiceme.com
  FRONTEND_URL=http://localhost:8080
  SUPPORT_EMAIL=support@invoiceme.com
  ```

### Step 3: Test Email Configuration

- [ ] Run test script:
  ```bash
  cd backend
  npm run test:email
  ```
- [ ] Verify all tests pass (✅ green checkmarks)
- [ ] Check backend logs for: "Email service initialized with SMTP host"

### Step 4: Test Password Reset Email

- [ ] Start backend: `npm run start:dev`
- [ ] Request password reset:
  ```bash
  curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com"}'
  ```
- [ ] Check email inbox (Mailtrap/Ethereal)
- [ ] Verify email contains:
  - [ ] Subject: "Reset Your Password - InvoiceMe"
  - [ ] Reset link/button
  - [ ] Reset token in URL
  - [ ] Proper styling
- [ ] Test reset link opens correctly

### Step 5: Test Invoice Email

- [ ] Create a test invoice (via API or frontend)
- [ ] Send invoice email:
  ```bash
  curl -X POST http://localhost:3000/api/v1/invoices/INVOICE_ID/send \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
- [ ] Check email inbox
- [ ] Verify email contains:
  - [ ] Subject: "Invoice #XXX from YourCompany"
  - [ ] Invoice number, amount, currency
  - [ ] "View Invoice" button
  - [ ] "Download PDF" button (if PDF generated)
  - [ ] Support email in footer
- [ ] Test "View Invoice" link
- [ ] Test "Download PDF" link

---

## Production Setup

### Step 1: Choose Production Email Service

- [ ] **SendGrid** (Recommended)
  - [ ] Sign up at https://sendgrid.com
  - [ ] Verify email address
  - [ ] Create API key with "Mail Send" permissions
  - [ ] Copy API key (shown only once!)

- [ ] **Alternative: Mailgun, AWS SES, or Postmark**
  - [ ] Sign up and get SMTP credentials
  - [ ] Verify domain/email

### Step 2: Verify Sender

- [ ] **Option A: Single Sender Verification** (Quick)
  - [ ] Settings → Sender Authentication → Verify a Single Sender
  - [ ] Verify email address

- [ ] **Option B: Domain Authentication** (Recommended)
  - [ ] Settings → Sender Authentication → Authenticate Your Domain
  - [ ] Follow setup wizard
  - [ ] Note DNS records to add

### Step 3: Configure DNS Records (Domain Authentication)

- [ ] **SPF Record**
  - [ ] Type: TXT
  - [ ] Name: @
  - [ ] Value: `v=spf1 include:sendgrid.net ~all`
  - [ ] TTL: 3600

- [ ] **DKIM Records**
  - [ ] Add all records provided by SendGrid
  - [ ] Multiple TXT records with selectors

- [ ] **DMARC Record**
  - [ ] Type: TXT
  - [ ] Name: _dmarc
  - [ ] Value: `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`
  - [ ] TTL: 3600

- [ ] Wait for DNS propagation (1-24 hours)
- [ ] Verify DNS records using:
  - [ ] [MXToolbox SPF Checker](https://mxtoolbox.com/spf.aspx)
  - [ ] [MXToolbox DMARC Checker](https://mxtoolbox.com/dmarc.aspx)
- [ ] Check email service dashboard for verification status

### Step 4: Configure Production Environment

- [ ] Copy `backend/.env.production.example` to production `.env`
- [ ] Update email configuration:
  ```env
  SMTP_HOST=smtp.sendgrid.net
  SMTP_PORT=587
  SMTP_USER=apikey
  SMTP_PASS=your-sendgrid-api-key-here
  EMAIL_FROM=noreply@yourdomain.com
  FRONTEND_URL=https://app.yourdomain.com
  SUPPORT_EMAIL=support@yourdomain.com
  ```
- [ ] Verify all other production environment variables are set
- [ ] Run validation script: `./backend/scripts/validate-env.sh`

### Step 5: Test Production Emails

- [ ] Deploy backend with production environment variables
- [ ] Test password reset email:
  ```bash
  curl -X POST https://api.yourdomain.com/api/v1/auth/password-reset-request \
    -H "Content-Type: application/json" \
    -d '{"email": "your-email@example.com"}'
  ```
- [ ] Check email inbox (and spam folder)
- [ ] Test invoice email:
  ```bash
  curl -X POST https://api.yourdomain.com/api/v1/invoices/INVOICE_ID/send \
    -H "Authorization: Bearer YOUR_TOKEN"
  ```
- [ ] Verify all email links work correctly
- [ ] Check email service dashboard for:
  - [ ] Delivery statistics
  - [ ] Bounce rates
  - [ ] Spam complaints

### Step 6: Monitor and Maintain

- [ ] Set up email delivery monitoring
- [ ] Review bounce rates regularly
- [ ] Monitor spam complaints
- [ ] Rotate API keys every 90 days
- [ ] Update DNS records if needed (DMARC policy changes)

---

## Troubleshooting Checklist

If emails aren't working:

- [ ] **SMTP not configured**
  - [ ] Check `SMTP_HOST` is set in `.env`
  - [ ] Restart backend after updating `.env`
  - [ ] Run `npm run test:email` to verify

- [ ] **Connection refused**
  - [ ] Verify `SMTP_HOST` and `SMTP_PORT` are correct
  - [ ] Check firewall allows outbound SMTP (port 587/465)
  - [ ] Test connection: `telnet smtp.sendgrid.net 587`

- [ ] **Authentication failed**
  - [ ] For SendGrid: Ensure `SMTP_USER=apikey` (literal string)
  - [ ] Verify API key is correct and not expired
  - [ ] Regenerate API key if needed

- [ ] **Emails not received**
  - [ ] Check spam/junk folder
  - [ ] Verify email address is correct
  - [ ] Check email service dashboard for bounces
  - [ ] Review email service logs

- [ ] **Emails going to spam**
  - [ ] Verify domain in email service provider
  - [ ] Add SPF, DKIM, DMARC DNS records
  - [ ] Wait for DNS propagation
  - [ ] Monitor domain reputation

---

## Quick Reference

### Test Commands

```bash
# Test email configuration
cd backend && npm run test:email

# Check health
curl http://localhost:3000/api/health

# Request password reset
curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Send invoice
curl -X POST http://localhost:3000/api/v1/invoices/INVOICE_ID/send \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Required Environment Variables

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-api-key
EMAIL_FROM=noreply@yourdomain.com
FRONTEND_URL=https://app.yourdomain.com
SUPPORT_EMAIL=support@yourdomain.com
```

### Documentation

- 📖 [Email Testing Guide](./docs/EMAIL_TESTING_GUIDE.md) - Detailed guide
- 🚀 [Email Setup Quick Start](./docs/EMAIL_SETUP_QUICKSTART.md) - 5-minute setup
- 📋 [Deployment Guide](./DEPLOYMENT.md) - Full deployment instructions

---

## Completion

Once all items are checked:

- ✅ Development emails working
- ✅ Production emails working
- ✅ DNS records configured
- ✅ Monitoring set up
- ✅ Documentation reviewed

**You're ready to send emails! 🎉**

