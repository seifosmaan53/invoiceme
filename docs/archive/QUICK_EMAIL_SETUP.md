# ⚡ Quick Email Setup Guide

## 🚀 Fastest Way (30 Seconds)

```bash
cd backend
npm run setup:email
```

**Done!** That's it. Emails are now configured.

---

## 📱 On a New Device?

### Option 1: Run Script Again (30 sec)
```bash
cd backend
npm run setup:email
```

### Option 2: Use Saved Credentials (1 min)
1. Get credentials from password manager
2. Run: `npm run setup:email:quick`
3. Choose option 3 (Use saved credentials)
4. Paste credentials

---

## 💾 Save Your Credentials!

**After running `npm run setup:email`:**
1. Copy the credentials shown
2. Save in password manager (1Password, LastPass, etc.)
3. On new device: Just paste them!

**This way you only set up once, then reuse!**

---

## 🎯 Interactive Setup

For a guided setup with options:

```bash
cd backend
npm run setup:email:quick
```

Choose:
- **1** = Automatic (Ethereal Email) - 30 sec
- **2** = Manual (Mailtrap) - 2 min
- **3** = Use saved credentials - 1 min

---

## ✅ Verify It Works

```bash
npm run test:email
```

Should see: ✅ All tests passed!

---

## 📝 That's It!

**Setup time:** 30 seconds  
**On new device:** 30 seconds (or 1 min with saved credentials)  
**Frequency:** Once per device

**It's really that simple!** 🎉

