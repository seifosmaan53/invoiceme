# SMTP Quick Setup Guide

## 🚀 Fast Setup (5 Minutes)

### Option 1: Interactive Setup Script (Easiest)

```bash
cd backend
npm run setup:smtp
```

This will guide you through setting up SMTP with:
- Mailtrap (recommended for development)
- Gmail (for testing)
- Manual configuration

### Option 2: Manual Setup

1. **Edit `.env` file** in the `backend` directory:

```bash
# For Mailtrap (Development - Recommended)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your-mailtrap-username
SMTP_PASS=your-mailtrap-password
EMAIL_FROM=noreply@invoiceme.com
FRONTEND_URL=http://localhost:8080
```

2. **Get Mailtrap credentials:**
   - Sign up at https://mailtrap.io (free tier)
   - Create an inbox
   - Go to inbox settings > SMTP Settings
   - Copy credentials

3. **Restart backend server**

### Option 3: Gmail Setup (Testing)

1. **Enable 2-factor authentication** on your Google account
2. **Generate App Password:**
   - Visit: https://myaccount.google.com/apppasswords
   - Generate a 16-character app password
3. **Add to `.env`:**

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
EMAIL_FROM=your-email@gmail.com
```

---

## 🧪 Test Your Configuration

### Test Email Script

```bash
cd backend
npm run test:email your-email@example.com
```

This will:
- ✅ Verify SMTP connection
- ✅ Send a test email
- ✅ Show any configuration errors

### Verify in Backend Logs

When you start the backend, you should see:
```
Email service initialized with SMTP host: sandbox.smtp.mailtrap.io:2525
SMTP connection verified successfully
```

If you see warnings, SMTP is not configured correctly.

---

## 📧 What Emails Are Sent?

Once configured, the app automatically sends:

1. **Password Reset Emails**
   - When user requests password reset
   - Contains reset link with token

2. **Invoice Emails**
   - When invoice is sent to client
   - Includes PDF attachment
   - Professional HTML template

3. **Notifications**
   - Invoice overdue (daily cron)
   - Payment received
   - Invoice sent
   - Invoice paid

---

## 🔧 Troubleshooting

### "SMTP_HOST not configured"
- Add `SMTP_HOST` to your `.env` file
- Restart backend server

### "SMTP Connection Failed"
- Check `SMTP_HOST` and `SMTP_PORT` are correct
- Verify firewall isn't blocking connection
- For Gmail: Use App Password, not regular password

### "Authentication Failed"
- Check `SMTP_USER` and `SMTP_PASS` are correct
- For Gmail: Must use App Password (16 characters)
- Generate at: https://myaccount.google.com/apppasswords

### "Email not sending"
- Check backend logs for errors
- Verify SMTP credentials are correct
- Test with: `npm run test:email your-email@example.com`

---

## 📚 More Information

- **Full Setup Guide:** `docs/EMAIL_SETUP_COMPLETE.md`
- **Environment Variables:** `backend/env.example`
- **Email Service Code:** `backend/src/core/services/email.service.ts`

---

## ✅ Quick Checklist

- [ ] SMTP credentials added to `.env`
- [ ] Backend restarted
- [ ] SMTP connection verified (check logs)
- [ ] Test email sent successfully
- [ ] Password reset email tested
- [ ] Invoice email tested

---

**That's it! Your email notifications are now configured.** 🎉

