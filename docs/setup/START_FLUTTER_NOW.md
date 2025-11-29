# 🚀 Start Flutter App Now

## Error -102 = Connection Refused

This means **Flutter app is not running** on port 8080.

## ✅ Quick Start

**Open a terminal and run:**

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

**Wait for:**
- Chrome to open automatically
- Or see the URL in terminal: `http://localhost:8080`

## 📋 Full Checklist

### 1. Backend Must Be Running
```bash
# In Terminal 1:
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

Wait for: `Application is running on: http://localhost:3000/api`

### 2. Flutter App Must Be Running
```bash
# In Terminal 2:
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

Wait for: Chrome to open or see the URL

### 3. Both Should Be Running
- ✅ Backend on `http://localhost:3000`
- ✅ Flutter on `http://localhost:8080`

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

## ⚠️ Important

- **Keep both terminals open** - Closing them stops the apps
- **Backend must start first** - Then start Flutter
- **Wait for "Application is running"** before starting Flutter

