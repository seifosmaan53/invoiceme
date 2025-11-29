# 🚀 Email Setup Quick Start

Get email functionality working in 5 minutes!

## Development Setup (Mailtrap)

### 1. Get Mailtrap Credentials (2 minutes)

1. Go to [https://mailtrap.io](https://mailtrap.io) and sign up (free)
2. Create an inbox named "InvoiceMe Development"
3. Go to inbox settings → SMTP Settings → Copy credentials

### 2. Configure Backend (1 minute)

```bash
cd backend
cp env.example .env
```

Edit `backend/.env` and add:

```env
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your-mailtrap-username
SMTP_PASS=your-mailtrap-password
EMAIL_FROM=noreply@invoiceme.com
FRONTEND_URL=http://localhost:8080
SUPPORT_EMAIL=support@invoiceme.com
```

### 3. Test Configuration (1 minute)

```bash
npm run test:email
```

You should see: ✅ All tests passed!

### 4. Test Real Email (1 minute)

Start backend:
```bash
npm run start:dev
```

Request password reset:
```bash
curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

Check Mailtrap inbox - you should see the email! 🎉

---

## Production Setup (SendGrid)

### 1. Sign Up for SendGrid (2 minutes)

1. Go to [https://sendgrid.com](https://sendgrid.com) and sign up
2. Verify your email address
3. Go to Settings → API Keys → Create API Key
4. Name: "InvoiceMe Production"
5. Permissions: "Mail Send" or "Full Access"
6. **Copy the API key** (shown only once!)

### 2. Verify Domain (5 minutes)

**Option A: Single Sender (Quick)**
- Settings → Sender Authentication → Verify a Single Sender
- Verify the email address

**Option B: Domain Authentication (Recommended)**
- Settings → Sender Authentication → Authenticate Your Domain
- Follow the wizard
- Add DNS records to your domain

### 3. Configure Production Environment

Use `.env.production.example` as template:

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key-here
EMAIL_FROM=noreply@yourdomain.com
FRONTEND_URL=https://app.yourdomain.com
SUPPORT_EMAIL=support@yourdomain.com
```

### 4. Add DNS Records (Domain Authentication)

Add these to your domain DNS:

**SPF Record:**
```
Type: TXT
Name: @
Value: v=spf1 include:sendgrid.net ~all
```

**DKIM Records:**
- Provided by SendGrid in domain settings
- Add all records shown

**DMARC Record:**
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com
```

### 5. Test Production

Deploy and test:
```bash
# Test password reset
curl -X POST https://api.yourdomain.com/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@example.com"}'
```

Check your email inbox (and spam folder initially).

---

## Quick Troubleshooting

**"SMTP not configured" warning:**
- Add `SMTP_HOST` to `.env`
- Restart backend

**"Connection refused":**
- Check `SMTP_HOST` and `SMTP_PORT`
- Verify firewall allows port 587/465

**"Authentication failed":**
- For SendGrid: Ensure `SMTP_USER=apikey` (literal string)
- Verify API key is correct
- Check credentials in email service dashboard

**Emails not received:**
- Check spam folder
- Verify email address
- Check email service dashboard for bounces

---

## Next Steps

- ✅ Test password reset email
- ✅ Test invoice email
- ✅ Verify all links work
- ✅ Set up production email service
- ✅ Configure DNS records
- ✅ Monitor email delivery

For detailed instructions, see [EMAIL_TESTING_GUIDE.md](./EMAIL_TESTING_GUIDE.md)

