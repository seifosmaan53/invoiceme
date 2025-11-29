# 🚀 Start Flutter App - Quick Guide

## Error -102 = Flutter App Not Running

The Flutter app needs to be running for the browser to connect.

## ✅ Start Flutter App

**Open a terminal and run:**

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

**Wait for:**
- Chrome to open automatically, OR
- See the URL in terminal: `http://localhost:8080`

## 📋 Both Apps Must Be Running

### Terminal 1: Backend
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

**Should show:**
```
Application is running on: http://localhost:3000/api
```

### Terminal 2: Flutter
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

**Should show:**
```
Launching lib/main.dart on Chrome in debug mode...
```

## ⚠️ Important

- **Keep both terminals open** - Closing them stops the apps
- **Backend must start first** - Then start Flutter
- **Wait for compilation** - First run takes 30-60 seconds

## 🔍 Troubleshooting

### "Port 8080 already in use"
```bash
# Kill whatever is using port 8080
lsof -ti :8080 | xargs kill -9

# Then start Flutter
flutter run -d chrome --web-port=8080
```

### "Flutter compilation errors"
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter clean
flutter pub get
flutter run -d chrome --web-port=8080
```

### "Chrome doesn't open"
- Check terminal for the URL
- Manually open: `http://localhost:8080` in Chrome

## ✅ Quick Check

1. **Backend running?**
   ```bash
   curl http://localhost:3000/api/health
   ```
   Should return: `{"status":"ok",...}`

2. **Flutter running?**
   - Open: `http://localhost:8080` in browser
   - Should see the app (login screen or dashboard)

3. **Both running?**
   - ✅ Backend terminal shows "Application is running"
   - ✅ Flutter terminal shows "Launching" or "Running"
   - ✅ Browser shows the app (not error -102)

