# 🚨 URGENT: Start Flutter App Now

## Error -102 = Flutter App is NOT Running

You **MUST** start the Flutter app manually in a terminal.

## ✅ Step-by-Step Instructions

### Step 1: Open a New Terminal Window
- Open Terminal app (or iTerm, etc.)
- **Keep this terminal open** - don't close it!

### Step 2: Navigate to Mobile Folder
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
```

### Step 3: Start Flutter App
```bash
flutter run -d chrome --web-port=8080
```

### Step 4: Wait for Compilation
- First time: Takes 30-60 seconds
- You'll see: "Launching lib/main.dart on Chrome..."
- Chrome should open automatically
- If not, manually open: `http://localhost:8080`

## ⚠️ CRITICAL: Both Apps Must Be Running

### Terminal 1: Backend (MUST be running)
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

**Check:** Should see `Application is running on: http://localhost:3000/api`

### Terminal 2: Flutter (MUST be running)
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

**Check:** Should see `Launching lib/main.dart on Chrome...`

## 🔍 If Flutter Won't Start

### Check for Errors
Look at the terminal output - it will show:
- ✅ Success: "Launching..." or "Running..."
- ❌ Error: Red text with error messages

### Common Fixes

**1. Port 8080 in use:**
```bash
lsof -ti :8080 | xargs kill -9
flutter run -d chrome --web-port=8080
```

**2. Compilation errors:**
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter clean
flutter pub get
flutter run -d chrome --web-port=8080
```

**3. Chrome not available:**
```bash
# Use a different browser or check Chrome installation
flutter devices  # See available devices
```

## ✅ Verification

Once both are running:

1. **Backend:** `curl http://localhost:3000/api/health` → Should return JSON
2. **Flutter:** Open `http://localhost:8080` → Should show app (not error -102)

## 📝 Quick Checklist

- [ ] Terminal 1: Backend running (`npm run start:dev`)
- [ ] Terminal 2: Flutter running (`flutter run -d chrome`)
- [ ] Browser: Open `http://localhost:8080`
- [ ] See app (not error -102)

**If you see Error -102, the Flutter app is NOT running. Start it in Terminal 2!**

