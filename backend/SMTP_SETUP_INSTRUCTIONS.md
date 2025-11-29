# SMTP Setup Instructions

## 🚀 Quick Setup (Choose One Method)

### Method 1: Interactive Script (Easiest)

```bash
cd backend
npm run setup:smtp
```

**What it does:**
- Shows you SMTP provider options
- Prompts for credentials
- Automatically updates `.env` file
- Provides next steps

**Follow the prompts:**
1. Choose provider (1-4):
   - `1` = Mailtrap (Recommended for Development)
   - `2` = Ethereal Email (Quick Testing)
   - `3` = Gmail (Personal Testing)
   - `4` = Skip (Manual setup)

2. Enter credentials when prompted
3. Script updates `.env` automatically

---

### Method 2: Manual Setup

1. **Edit `.env` file** in `backend` directory:

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
   - Sign up: https://mailtrap.io (free tier)
   - Create inbox
   - Go to: Inbox Settings > SMTP Settings
   - Copy credentials

3. **Restart backend server**

---

### Method 3: Gmail Setup

1. **Enable 2-factor authentication** on Google account
2. **Generate App Password:**
   - Visit: https://myaccount.google.com/apppasswords
   - Generate 16-character password
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

After setup, test it:

```bash
cd backend
npm run test:email your-email@example.com
```

**Expected output:**
```
✅ SMTP Connection Verified!
✅ Test email sent successfully!
🎉 Your SMTP configuration is working correctly!
```

---

## ✅ Verify It's Working

### Check Backend Logs

When you start the backend, you should see:
```
Email service initialized with SMTP host: sandbox.smtp.mailtrap.io:2525
SMTP connection verified successfully
```

### Test Email Features

1. **Password Reset:**
   - Request password reset via API
   - Check email inbox (or Mailtrap inbox)

2. **Invoice Email:**
   - Send invoice via email
   - Check email inbox

---

## 🔧 Troubleshooting

### "SMTP_HOST not configured"
- Run setup script: `npm run setup:smtp`
- Or manually edit `.env` file

### "SMTP Connection Failed"
- Check credentials are correct
- Verify firewall isn't blocking
- For Gmail: Use App Password (not regular password)

### "Authentication Failed"
- Double-check `SMTP_USER` and `SMTP_PASS`
- For Gmail: Must be 16-character App Password

---

## 📚 More Help

- **Quick Setup:** `docs/SMTP_QUICK_SETUP.md`
- **Complete Guide:** `docs/EMAIL_SETUP_COMPLETE.md`
- **Test Script:** `backend/scripts/test-email.js`

---

**Ready to configure? Run: `npm run setup:smtp`** 🚀

