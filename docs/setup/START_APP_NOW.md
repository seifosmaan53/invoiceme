# 🚀 Start the App - Step by Step

## The Problem
**Connection refused (-102)** means the Flutter app isn't running yet. It needs to be started and compiled first.

## ✅ Solution: Start Flutter App

### Option 1: Use the Script (Easiest)

```bash
cd "/Users/seifosman/Desktop/invoice maker"
./START_FLUTTER_APP.sh
```

### Option 2: Manual Start

**Open a NEW terminal window** and run:

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```

## ⏱️ What to Expect

1. **First time:** Takes 30-60 seconds to compile
2. **You'll see:**
   ```
   Launching lib/main.dart on Chrome in debug mode...
   Building web application...
   ```
3. **Browser opens automatically** when ready
4. **App loads** at `http://localhost:XXXX` (Flutter assigns port)

## ⚠️ IMPORTANT: Backend Must Be Running First!

**Before starting Flutter, make sure backend is running:**

**In a SEPARATE terminal:**
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

Wait for:
```
✅ Swagger API documentation enabled at /api/docs
Application is running on: http://localhost:3000/api
```

## 📋 Complete Setup (2 Terminals)

### Terminal 1 - Backend:
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

### Terminal 2 - Flutter:
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```

## 🔍 Troubleshooting

### "Connection refused" after starting
- **Wait longer** - First compilation takes 30-60 seconds
- **Check terminal** - Look for errors
- **Verify backend** - Must be running on port 3000

### "Flutter not found"
```bash
# Check Flutter is installed
flutter doctor

# If not, install Flutter first
```

### "Port already in use"
```bash
# Kill process on port 8080
lsof -ti :8080 | xargs kill -9

# Then start Flutter again
flutter run -d chrome
```

### App crashes
```bash
# Clean and rebuild
cd mobile
flutter clean
flutter pub get
flutter run -d chrome
```

## 🎯 Quick Test

Once both are running:

1. **Backend:** `curl http://localhost:3000/api/health` → Should return JSON
2. **Flutter:** Browser opens automatically → Should see login screen
3. **Try registering** → Should work if backend is running

## 💡 Pro Tip

**Keep both terminals open:**
- Terminal 1: Backend (keep running)
- Terminal 2: Flutter (keep running for hot reload)

Don't close these terminals while developing!

