# 🚀 Quick Start - Web App

## ✅ Current Status

- ✅ **Backend is running** on `http://localhost:3000`
- ⚠️ **Flutter web app needs to be started**

## 🚀 Start Flutter Web App

**Open a terminal and run:**

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome --web-port=8080
```

### What Happens:

1. **First time:** Takes 30-60 seconds to compile
2. **Chrome opens automatically** at: `http://localhost:8080`
3. **If Chrome doesn't open:** Check the terminal for the exact URL

### ⚠️ Important:

- **Keep the terminal open** - Closing it stops the app
- **Wait for compilation** - Don't try to access the URL until you see "Running" in terminal
- **Use the URL from terminal** - Don't hardcode `localhost:8080` if Flutter uses a different port

## ✅ Verify Everything Works

### 1. Backend (Already Running ✅)
```bash
curl http://localhost:3000/api/health
```
Should return: `{"status":"ok",...}`

### 2. Flutter Web
- Open the URL shown in terminal (usually `http://localhost:8080`)
- You should see the **login/register screen**
- No "Connection Refused" errors

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
   - Use the URL from the terminal

3. **Wait for compilation:**
   - First run takes 30-60 seconds
   - Don't try to access URL until you see "Running"

### Chrome Doesn't Open
- Check the terminal for the URL
- Manually open Chrome and navigate to that URL
- The URL will be something like: `http://localhost:8080` or `http://localhost:65102`

## 📝 Summary

1. ✅ Backend is running (port 3000)
2. ⚠️ Start Flutter: `flutter run -d chrome --web-port=8080`
3. ⏳ Wait 30-60 seconds for compilation
4. 🌐 Open the URL shown in terminal
5. ✅ You should see the login screen!

