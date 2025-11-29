# 🚀 START HERE - Email Setup

## ✅ Everything is Ready!

Your email functionality is **fully configured and ready to use**. Just follow these 3 simple steps:

---

## Step 1: Get Mailtrap Credentials (2 minutes)

1. Visit **[https://mailtrap.io](https://mailtrap.io)** and sign up (free, no credit card)
2. Create an inbox → Click "SMTP Settings"
3. Copy these values:
   - Host: `sandbox.smtp.mailtrap.io`
   - Port: `2525`
   - Username: (from Mailtrap)
   - Password: (from Mailtrap)

---

## Step 2: Configure Backend (1 minute)

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

**Replace** `your-mailtrap-username` and `your-mailtrap-password` with your actual Mailtrap credentials.

---

## Step 3: Test It! (1 minute)

```bash
# Install dotenv (one-time, if needed)
npm install dotenv --save-dev

# Test email configuration
npm run test:email
```

**Expected output:**
```
✅ SMTP_HOST: sandbox.smtp.mailtrap.io
✅ SMTP connection verified successfully
✅ All tests passed!
```

---

## 🎉 You're Done!

Now test a real email:

```bash
# Start backend
npm run start:dev

# Test password reset (in another terminal)
curl -X POST http://localhost:3000/api/v1/auth/password-reset-request \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

**Check your Mailtrap inbox** - you'll see the email! 🎉

---

## 📚 Need More Help?

- **Quick Reference**: `EMAIL_READY.md`
- **Step-by-Step Checklist**: `EMAIL_SETUP_CHECKLIST.md`
- **Detailed Guide**: `docs/EMAIL_TESTING_GUIDE.md`
- **Backend Quick Ref**: `backend/README_EMAIL.md`

---

## 🔧 Quick Troubleshooting

**"dotenv not found"**
```bash
npm install dotenv --save-dev
```

**"SMTP_HOST not configured"**
- Make sure `.env` file exists in `backend/` directory
- Check `SMTP_HOST` is set in `.env`
- Restart backend after updating `.env`

**"Connection refused"**
- Verify `SMTP_HOST` and `SMTP_PORT` are correct
- Make sure you're using **inbox SMTP credentials** from Mailtrap

---

**That's it! You're ready to send emails! 🚀**

