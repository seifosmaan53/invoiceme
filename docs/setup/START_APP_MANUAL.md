# 🚨 MANUAL START REQUIRED

## The Flutter app must be started manually in a terminal

Error -102 means the Flutter dev server is **NOT running** on port 8080.

## ✅ Step-by-Step Instructions

### 1. Open a NEW Terminal Window
- **Keep this terminal open** - closing it stops the app!

### 2. Navigate to Mobile Folder
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
```

### 3. Start Flutter App
```bash
flutter run -d chrome --web-port=8080
```

### 4. Wait for Compilation
- **First run:** 1-2 minutes
- **Subsequent runs:** 30-60 seconds
- Look for: `Launching lib/main.dart on Chrome...`
- Chrome should open automatically when ready

### 5. If Chrome Doesn't Open
- Manually open: `http://localhost:8080`
- The app should load

## ⚠️ CRITICAL: Both Apps Must Run

### Terminal 1: Backend
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

**Verify:** Should see `Application is running on: http://localhost:3000/api`

### Terminal 2: Flutter (YOU MUST DO THIS)
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

**Verify:** Should see `Launching lib/main.dart on Chrome...`

## 🔍 Troubleshooting

### If Flutter Shows Errors
1. **Compilation errors:** Check the terminal output
2. **Port in use:**
   ```bash
   lsof -ti :8080 | xargs kill -9
   flutter run -d chrome --web-port=8080
   ```
3. **Dependencies missing:**
   ```bash
   flutter clean
   flutter pub get
   flutter run -d chrome --web-port=8080
   ```

### Check if Running
```bash
# Check port 8080
lsof -i :8080 | grep LISTEN

# If you see output, Flutter is running!
```

## ✅ Success Indicators

- ✅ Terminal shows: `Launching...` or `Running...`
- ✅ Chrome opens automatically
- ✅ Browser shows app (not error -102)
- ✅ Can see login/register screen

## 📝 Quick Checklist

- [ ] Terminal 1: Backend running (`npm run start:dev`)
- [ ] Terminal 2: Flutter running (`flutter run -d chrome`)
- [ ] Browser: Open `http://localhost:8080`
- [ ] App loads (not error -102)

---

**⚠️ IMPORTANT: The Flutter app CANNOT start automatically in the background. You MUST run it manually in a terminal window and keep that terminal open!**

