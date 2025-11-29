# ✅ Email Functionality - Ready to Use!

Your email system is fully configured and ready. Follow these simple steps to start sending emails.

## 🚀 Quick Start (3 Steps)

### 1. Get Mailtrap Credentials (2 minutes)

**Mailtrap** is a free email testing service - perfect for development.

1. Go to **[https://mailtrap.io](https://mailtrap.io)** and sign up (free, no credit card)
2. Click "Add Inbox" → Name it "InvoiceMe Development"
3. Click on the inbox → Go to "SMTP Settings" tab
4. Copy these values:
   - **Host**: `sandbox.smtp.mailtrap.io`
   - **Port**: `2525`
   - **Username**: (shown in Mailtrap)
   - **Password**: (shown in Mailtrap)

### 2. Configure Your Backend (1 minute)

```bash
cd backend

# Create .env file if it doesn't exist
cp env.example .env

# Edit .env file and add these lines:
```

Open `backend/.env` and add/update:

```env
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your-mailtrap-username-here
SMTP_PASS=your-mailtrap-password-here
EMAIL_FROM=noreply@invoiceme.com
FRONTEND_URL=http://localhost:8080
SUPPORT_EMAIL=support@invoiceme.com
```

**Replace** `your-mailtrap-username-here` and `your-mailtrap-password-here` with your actual Mailtrap credentials.

### 3. Test It! (1 minute)

```bash
# Install dotenv if needed (one-time setup)
npm install dotenv --save-dev

# Test email configuration
npm run test:email
```

You should see:
```
✅ SMTP_HOST: sandbox.smtp.mailtrap.io
✅ SMTP connection verified successfully
✅ All tests passed!
```

---

## 📧 Test Real Emails

### Test Password Reset Email

```bash
# Start your backend
npm run start:dev

# In another terminal, test password reset
curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

**Then check your Mailtrap inbox** - you'll see the email! 🎉

### Test Invoice Email

1. Create an invoice (via API or frontend)
2. Send it:
   ```bash
   curl -X POST http://localhost:3000/api/v1/invoices/INVOICE_ID/send \
     -H "Authorization: Bearer YOUR_TOKEN"
   ```
3. Check Mailtrap inbox for the invoice email

---

## 🔧 Troubleshooting

### "dotenv not found" Error

```bash
cd backend
npm install dotenv --save-dev
```

### "SMTP_HOST not configured"

- Make sure `.env` file exists in `backend/` directory
- Check that `SMTP_HOST` is set (no quotes around the value)
- Restart backend after updating `.env`

### "Connection refused"

- Verify `SMTP_HOST` and `SMTP_PORT` match Mailtrap settings exactly
- Check your internet connection
- Make sure you're using **inbox SMTP credentials** (not API credentials)

### "Authentication failed"

- Double-check `SMTP_USER` and `SMTP_PASS` in `.env`
- Make sure there are no extra spaces or quotes
- Regenerate credentials in Mailtrap if needed

---

## 📚 What's Included

✅ **Email Service** - Fully configured with SMTP support  
✅ **Test Script** - `npm run test:email` to verify configuration  
✅ **Password Reset Emails** - Ready to use  
✅ **Invoice Emails** - Ready to use  
✅ **Documentation** - Complete guides in `docs/` folder  

### Files Created:

- `backend/scripts/test-email.js` - Email testing script
- `backend/README_EMAIL.md` - Quick reference
- `EMAIL_SETUP_CHECKLIST.md` - Step-by-step checklist
- `docs/EMAIL_SETUP_QUICKSTART.md` - 5-minute setup guide
- `docs/EMAIL_TESTING_GUIDE.md` - Complete testing guide
- `backend/.env.production.example` - Production template

---

## 🎯 Next Steps

1. ✅ **Get Mailtrap credentials** (2 min)
2. ✅ **Add to `.env` file** (1 min)
3. ✅ **Run `npm run test:email`** (1 min)
4. ✅ **Start sending emails!**

---

## 📖 More Help

- **Quick Reference**: `backend/README_EMAIL.md`
- **Full Checklist**: `EMAIL_SETUP_CHECKLIST.md`
- **Testing Guide**: `docs/EMAIL_TESTING_GUIDE.md`
- **Production Setup**: `DEPLOYMENT.md` (Email/SMTP section)

---

## ✨ You're All Set!

Your email functionality is **ready to use**. Just add your Mailtrap credentials to `.env` and you're good to go! 🚀

**Need help?** Check the troubleshooting section above or see the detailed guides in the `docs/` folder.

