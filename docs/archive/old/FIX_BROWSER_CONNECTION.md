# 🔧 Fix Browser Connection Refused Error

## The Problem
**Error: Connection refused (-102)** means the Flutter app isn't running on port 8080.

## ✅ Solution: Start Flutter App Properly

### Step 1: Make sure you're in the mobile directory

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
```

### Step 2: Start Flutter web app

```bash
flutter run -d chrome
```

**OR specify a port:**

```bash
flutter run -d chrome --web-port=8080
```

### Step 3: Wait for compilation

You'll see:
```
Launching lib/main.dart on Chrome in debug mode...
```

Then wait for:
```
Flutter run key commands.
```

The browser should open automatically.

## 🔍 Troubleshooting

### "Port already in use"
```bash
# Kill whatever is using port 8080
lsof -ti :8080 | xargs kill -9

# Then start Flutter again
flutter run -d chrome
```

### "Flutter not found"
```bash
# Check Flutter is installed
flutter doctor

# If not installed, install it first
```

### "Dependencies not installed"
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter pub get
flutter run -d chrome
```

### App crashes on startup
```bash
# Clean and rebuild
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter clean
flutter pub get
flutter run -d chrome
```

## 📋 Quick Start (Full Process)

**Terminal 1 - Backend:**
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

**Terminal 2 - Flutter:**
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```

## ⚠️ Important Notes

1. **Backend must be running first** - Flutter app needs the backend API
2. **Wait for compilation** - First run takes 30-60 seconds
3. **Browser opens automatically** - Don't manually navigate to localhost:8080
4. **Check terminal output** - Look for errors in the Flutter terminal

## 🎯 What Should Happen

1. Run `flutter run -d chrome`
2. See compilation messages
3. Browser opens automatically
4. App loads (login screen)
5. No connection errors!

## 🔄 If Still Not Working

1. **Check Flutter is working:**
   ```bash
   flutter doctor
   ```

2. **Try a different port:**
   ```bash
   flutter run -d chrome --web-port=5000
   ```

3. **Check for errors:**
   - Look at terminal output
   - Check browser console (F12)

4. **Restart everything:**
   ```bash
   # Kill all Flutter processes
   pkill -f flutter
   
   # Clean build
   cd mobile && flutter clean && flutter pub get
   
   # Start fresh
   flutter run -d chrome
   ```

