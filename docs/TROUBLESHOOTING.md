# 🔍 Troubleshooting Guide

## ✅ What's Working:

- ✅ **Backend:** Running on port 3000
- ✅ **PostgreSQL:** Running (port 5432)
- ✅ **API Docs:** Available at http://localhost:3000/api/docs

## ❌ What's Not Working:

**Flutter App:** Not running

## 🚀 Quick Fix:

### Option 1: Run Flutter Manually

Open a **NEW terminal window** and run:

```bash
cd ~/Desktop/invoice\ maker/mobile
flutter run -d chrome
```

This will:
- Compile the Flutter app
- Launch Chrome automatically
- Show the login screen

### Option 2: Use the Startup Script

```bash
cd ~/Desktop/invoice\ maker
./start_mobile.sh
```

## 🔍 Common Issues:

### 1. Chrome Not Opening

**Check if Chrome is installed:**
```bash
which google-chrome
# or
which chrome
```

**Try a different browser:**
```bash
flutter run -d web-server --web-port=8080
```
Then open: `http://localhost:8080`

### 2. Flutter Not Found

**Make sure Flutter is in PATH:**
```bash
export PATH="$PATH:$HOME/flutter/bin"
flutter --version
```

### 3. Connection Error Still Appears

**Verify backend is accessible:**
```bash
curl http://localhost:3000/api/docs
```

**Check Flutter API client configuration:**
- File: `mobile/lib/core/services/api_client.dart`
- Should have: `_baseUrl = 'http://localhost:3000/api/v1';`

### 4. Port Already in Use

**Kill process on port:**
```bash
lsof -ti:8080 | xargs kill -9
# or
lsof -ti:3000 | xargs kill -9
```

## 📱 Expected Result:

After running `flutter run -d chrome`:

1. **Terminal shows:**
   ```
   Launching lib/main.dart on Chrome in debug mode...
   Application running at http://localhost:XXXX
   ```

2. **Chrome opens automatically** with:
   - InvoiceMe login screen
   - Blue theme
   - Email/password fields

3. **No connection errors** (backend is running!)

## ✅ Current Status:

- ✅ Backend: Running
- ✅ Database: Connected
- ⏳ Flutter: Starting (run manually)

**Run Flutter manually in a new terminal to see the app!**

