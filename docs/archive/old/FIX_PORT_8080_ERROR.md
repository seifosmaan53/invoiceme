# 🔧 Fix Error -102 (Connection Refused on Port 8080)

## The Problem
**Error Code: -102** means the browser can't connect to `http://localhost:8080/` because nothing is running on that port.

## Quick Fix

### Option 1: Start Flutter App (Recommended)
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

Wait for Chrome to open automatically, or manually open: `http://localhost:8080`

### Option 2: Check What Port Flutter is Using
Flutter might be running on a different port. Check the terminal where you ran `flutter run` - it will show the URL.

Common ports:
- `http://localhost:5000` (default)
- `http://localhost:8080` (if specified)
- `http://localhost:65102` (random port)

## Verify It's Running

1. **Check if Flutter is running:**
   ```bash
   lsof -i :8080
   ```

2. **Or check all Flutter processes:**
   ```bash
   ps aux | grep "flutter run"
   ```

3. **Test the URL:**
   ```bash
   curl http://localhost:8080
   ```
   Should return HTML (the Flutter app)

## Common Issues

### Issue 1: Flutter App Crashed
**Solution:** Restart Flutter
```bash
# Kill any existing Flutter processes
pkill -f "flutter run"

# Start fresh
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

### Issue 2: Port 8080 is Used by Something Else
**Solution:** Use a different port
```bash
flutter run -d chrome --web-port=5000
```
Then open: `http://localhost:5000`

### Issue 3: Flutter Compilation Errors
**Solution:** Check terminal for errors
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter clean
flutter pub get
flutter run -d chrome --web-port=8080
```

## What Error -102 Means

- **-102 = ERR_CONNECTION_REFUSED**
- The browser is trying to connect to `http://localhost:8080/`
- But nothing is listening on that port
- **Solution:** Start the Flutter app on that port

## Quick Checklist

- [ ] Flutter app is running (`flutter run -d chrome`)
- [ ] Terminal shows "Launching lib/main.dart on Chrome"
- [ ] Chrome opens automatically (or manually open the URL shown)
- [ ] Backend is also running on port 3000
- [ ] Both terminals are open and running

## Next Steps

1. **Start Flutter app** (if not running)
2. **Wait for Chrome to open** (or open manually)
3. **Check browser console** (F12) for any errors
4. **Try logging in** - should work now!

