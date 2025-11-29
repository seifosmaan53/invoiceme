# 🚀 Quick Start Guide - Web App

## ✅ Current Status

- ✅ **Backend is running** on `http://localhost:3000`
- ⚠️ **Flutter web app needs to be started**

## 🚀 Start Flutter Web App

**Open a terminal and run:**

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

### What to Expect:

1. **First time:** Takes 30-60 seconds to compile
2. **Chrome will open automatically** at: `http://localhost:8080`
3. **If Chrome doesn't open:** Check the terminal for the URL

## 📋 Alternative: Use Default Port

If port 8080 is busy, use Flutter's default port:

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```

Flutter will assign a random port (like `http://localhost:65102`). Check the terminal output for the exact URL.

## ✅ Verify Everything is Running

### 1. Backend (Port 3000)
```bash
curl http://localhost:3000/api/health
```
Should return: `{"status":"ok",...}`

### 2. Flutter Web
- Open the URL shown in the terminal (usually `http://localhost:8080`)
- You should see the login/register screen

## 🔍 Troubleshooting

### "Port 8080 already in use"
```bash
# Kill whatever is using port 8080
lsof -ti :8080 | xargs kill -9

# Then start Flutter
flutter run -d chrome --web-port=8080
```

### "Connection Refused" Error
1. **Make sure backend is running:**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Make sure Flutter is running:**
   - Check terminal for "Launching" or "Running" message
   - Use the URL from the terminal, not a hardcoded one

3. **Wait for compilation:**
   - First run takes 30-60 seconds
   - Don't try to access the URL until you see "Running" in terminal

### Chrome Doesn't Open
- Check the terminal for the URL
- Manually open Chrome and navigate to that URL
- The URL will be something like: `http://localhost:8080` or `http://localhost:65102`

## 📝 Quick Checklist

- [ ] Backend running on port 3000 ✅ (already running)
- [ ] Flutter web app started
- [ ] Chrome opened with the app
- [ ] Can see login/register screen
- [ ] No "connection refused" errors

## 🎯 Next Steps

Once both are running:
1. Try registering a new account
2. Or login if you already have one
3. The app should connect to the backend automatically

