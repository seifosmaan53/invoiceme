# 📧 Email Setup - Ready to Use

## Quick Start (5 Minutes)

### Step 1: Get Mailtrap Credentials

1. Visit [https://mailtrap.io](https://mailtrap.io) and sign up (free, no credit card)
2. Create an inbox → Go to inbox settings → SMTP Settings
3. Copy these values:
   - Host: `sandbox.smtp.mailtrap.io`
   - Port: `2525`
   - Username: (your Mailtrap username)
   - Password: (your Mailtrap password)

### Step 2: Configure Environment

```bash
cd backend
cp env.example .env
```

Edit `backend/.env` and add/update:

```env
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your-mailtrap-username-here
SMTP_PASS=your-mailtrap-password-here
EMAIL_FROM=noreply@invoiceme.com
FRONTEND_URL=http://localhost:8080
SUPPORT_EMAIL=support@invoiceme.com
```

### Step 3: Test Configuration

```bash
npm run test:email
```

**Expected output:**
```
✅ SMTP_HOST: sandbox.smtp.mailtrap.io
✅ SMTP_PORT: 2525
✅ SMTP connection verified successfully
✅ All tests passed!
```

### Step 4: Test Real Email

```bash
# Start backend
npm run start:dev

# In another terminal, test password reset
curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

**Check Mailtrap inbox** - you should see the email! 🎉

---

## Test Commands

```bash
# Test email configuration
npm run test:email

# Test password reset email
curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Test invoice email (requires auth token)
curl -X POST http://localhost:3000/api/v1/invoices/INVOICE_ID/send \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Troubleshooting

**"SMTP_HOST not configured"**
- Make sure `.env` file exists in `backend/` directory
- Check that `SMTP_HOST` is set in `.env`
- Restart backend after updating `.env`

**"Connection refused"**
- Verify `SMTP_HOST` and `SMTP_PORT` are correct
- Check your internet connection
- For Mailtrap, ensure you're using inbox SMTP credentials (not API)

**"Authentication failed"**
- Double-check `SMTP_USER` and `SMTP_PASS` in `.env`
- For SendGrid: `SMTP_USER` must be exactly `apikey` (literal string)
- Regenerate credentials if needed

**Script not found**
```bash
# Make sure you're in backend directory
cd backend
npm run test:email
```

---

## Production Setup

For production, use SendGrid:

1. Sign up at [https://sendgrid.com](https://sendgrid.com)
2. Create API key with "Mail Send" permissions
3. Update production `.env`:
   ```env
   SMTP_HOST=smtp.sendgrid.net
   SMTP_PORT=587
   SMTP_USER=apikey
   SMTP_PASS=your-sendgrid-api-key
   EMAIL_FROM=noreply@yourdomain.com
   FRONTEND_URL=https://app.yourdomain.com
   SUPPORT_EMAIL=support@yourdomain.com
   ```

See `EMAIL_SETUP_CHECKLIST.md` for complete production setup.

---

## Documentation

- 📋 **Quick Checklist**: `EMAIL_SETUP_CHECKLIST.md`
- 🚀 **5-Minute Setup**: `docs/EMAIL_SETUP_QUICKSTART.md`
- 📖 **Full Guide**: `docs/EMAIL_TESTING_GUIDE.md`
- 🚀 **Deployment**: `DEPLOYMENT.md` (Email/SMTP section)

---

## Ready to Use! ✅

Your email functionality is ready. Just:
1. Get Mailtrap credentials (2 minutes)
2. Add to `.env` file (1 minute)
3. Run `npm run test:email` (1 minute)
4. Start sending emails! 🎉

