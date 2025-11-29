# 🔴 Backend Not Running - Quick Fix

## The Problem
**"Network error: XMLHttpRequest onError"** = Backend is **NOT running**

Your Flutter app is trying to connect to `http://localhost:3000/api/v1` but nothing is listening there.

## ✅ Solution: Start Backend

### Option 1: Use the Script (Easiest)

```bash
cd "/Users/seifosman/Desktop/invoice maker"
./START_BACKEND_AND_FLUTTER.sh
```

This will:
- ✅ Start backend automatically
- ✅ Wait for it to be ready
- ✅ Start Flutter app
- ✅ Open Chrome automatically

### Option 2: Manual Start (Recommended for Development)

**Open Terminal #1 - Backend:**
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

**Wait for:**
```
✅ Swagger API documentation enabled at /api/docs
Application is running on: http://localhost:3000/api
```

**Then open Terminal #2 - Flutter:**
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```

## 🧪 Verify Backend is Running

**Test in browser or terminal:**
```bash
curl http://localhost:3000/api/health
```

**Should return:**
```json
{"status":"ok","timestamp":"...","uptime":...,"database":"connected",...}
```

## ⚠️ Important Notes

1. **Backend MUST be running** - Flutter app can't work without it
2. **Keep backend terminal open** - Closing it stops the backend
3. **Refresh Flutter app** - After backend starts, refresh browser (`Cmd + Shift + R`)
4. **Check both terminals** - Both should be running without errors

## 🔍 Troubleshooting

### "Port 3000 already in use"
```bash
# Kill process on port 3000
lsof -ti :3000 | xargs kill -9

# Then start backend
cd backend && npm run start:dev
```

### "Cannot find module"
```bash
cd backend
npm install
npm run start:dev
```

### "Database connection error"
```bash
# Start PostgreSQL
brew services start postgresql@14

# Wait a few seconds, then start backend
cd backend && npm run start:dev
```

### Backend starts but Flutter still can't connect
1. **Check CORS:** Make sure `backend/.env` has:
   ```
   CORS_ORIGIN=http://localhost:3000,http://localhost:8080,http://localhost:5000,http://127.0.0.1:3000,http://127.0.0.1:8080,http://127.0.0.1:5000
   ```
2. **Restart backend** after changing `.env`
3. **Hard refresh Flutter app** (`Cmd + Shift + R`)

## 📋 Quick Checklist

- [ ] Backend terminal open and running
- [ ] See "Application is running on: http://localhost:3000/api"
- [ ] `curl http://localhost:3000/api/health` works
- [ ] Flutter app refreshed in browser
- [ ] Try register/login again

## 🎯 Expected Result

Once backend is running:
- ✅ No more "Network error" messages
- ✅ Registration/login works
- ✅ App connects to API successfully

**The backend is the key - start it first, then use the Flutter app!**

