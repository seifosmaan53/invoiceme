# 🌐 Starting Flutter App in Browser

## Quick Start

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```

## What Happens

1. Flutter will compile the app
2. Chrome browser will open automatically
3. App will load at `http://localhost:XXXX` (Flutter assigns a port)
4. You'll see the login/register screen

## ⚠️ Important: Backend Must Be Running

**Before starting Flutter, make sure the backend is running:**

```bash
# In a separate terminal:
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

Wait for:
```
✅ Swagger API documentation enabled at /api/docs
Application is running on: http://localhost:3000/api
```

## 🧪 Test It

1. **Backend running?** Check: `curl http://localhost:3000/api/health`
2. **Flutter app opens?** Should see login screen in browser
3. **Can register/login?** Try creating an account

## 🔧 Troubleshooting

### "Connection refused" error
- Backend is not running
- Start backend first: `cd backend && npm run start:dev`

### "Port already in use"
- Another Flutter instance is running
- Kill it: `lsof -ti:XXXX | xargs kill -9` (replace XXXX with port)

### App doesn't open
- Check terminal for errors
- Try: `flutter clean && flutter pub get && flutter run -d chrome`

## 📋 Quick Commands

```bash
# Start backend (Terminal 1)
cd backend && npm run start:dev

# Start Flutter web (Terminal 2)
cd mobile && flutter run -d chrome
```

## 🎯 What to Expect

- Browser opens automatically
- Login/Register screen appears
- After login → Dashboard
- Close and reopen → Auto-login (if token is valid)

