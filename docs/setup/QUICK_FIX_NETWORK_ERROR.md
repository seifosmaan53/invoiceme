# 🔧 Quick Fix: Network Error

## The Problem
**"Network error: XMLHttpRequest onError"** means your Flutter app can't connect to the backend.

## ✅ Solution: Start the Backend

The backend **must be running** for the Flutter app to work!

### Step 1: Open a New Terminal

Open a **separate terminal window** (keep it open).

### Step 2: Start the Backend

```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

### Step 3: Wait for This Message

```
✅ Swagger API documentation enabled at /api/docs
Application is running on: http://localhost:3000/api
```

**⚠️ IMPORTANT:** Don't close this terminal! The backend must keep running.

### Step 4: Test Backend

In a new terminal or browser, test:

```bash
curl http://localhost:3000/api/health
```

Or open in browser: **http://localhost:3000/api/health**

Should return: `{"status":"ok",...}`

### Step 5: Refresh Flutter App

1. Go back to your Flutter app in the browser
2. **Hard refresh:** `Cmd + Shift + R` (Mac) or `Ctrl + Shift + R` (Windows)
3. Try registering/login again

## 📋 Quick Checklist

- [ ] Backend terminal is open and running `npm run start:dev`
- [ ] See "Application is running on: http://localhost:3000/api"
- [ ] Test: `curl http://localhost:3000/api/health` works
- [ ] Flutter app refreshed in browser
- [ ] Try register/login again

## ⚠️ Common Issues

### "Port 3000 already in use"
```bash
# Kill whatever is using port 3000
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

### Backend starts but crashes
- Check terminal for error messages
- Verify PostgreSQL is running: `brew services list | grep postgresql`
- Check `.env` file exists: `ls backend/.env`

## 🎯 Why This Happens

- **Flutter app is running** ✅
- **Backend is NOT running** ❌
- **Result:** Network error (can't connect to API)

**Solution:** Start the backend in a separate terminal and keep it running!

## 💡 Pro Tip

**Keep 2 terminals open:**
1. **Terminal 1:** Backend (`npm run start:dev`) - Keep running
2. **Terminal 2:** Flutter (`flutter run -d chrome`) - Keep running

Both must be running for the app to work!

