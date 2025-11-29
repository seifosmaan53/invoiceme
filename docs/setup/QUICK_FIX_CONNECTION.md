# 🔧 Quick Fix: Connection Error

## The Problem
You're getting: `DioException [connection error]: The XMLHttpRequest onError callback was called`

**Root Cause:** Backend is running with OLD CORS settings. It needs to be restarted to pick up the new configuration.

## ✅ Solution (2 Steps)

### Step 1: Stop the Backend

Find the terminal where the backend is running and press:
```
Ctrl + C
```

Or kill it manually:
```bash
# Find the process
lsof -ti:3000

# Kill it (replace PID with the number from above)
kill -9 <PID>
```

### Step 2: Restart the Backend

```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

Wait for this message:
```
✅ Swagger API documentation enabled at /api/docs
Application is running on: http://localhost:3000/api
```

## 🧪 Test It

1. **Verify backend is running:**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Refresh your Flutter web app:**
   - Hard refresh: `Ctrl + Shift + R` (Windows/Linux) or `Cmd + Shift + R` (Mac)
   - Or close and reopen the browser tab

3. **Try registering again**

## 📋 What Changed

The `backend/.env` file now has:
```
CORS_ORIGIN=http://localhost:3000,http://localhost:8080,http://localhost:5000,http://127.0.0.1:3000,http://127.0.0.1:8080,http://127.0.0.1:5000
```

This allows your Flutter web app to connect from any common port.

## ⚠️ Important

- **You MUST restart the backend** after changing `.env` file
- The backend reads `.env` only when it starts
- Just changing the file doesn't update the running server

## 🔍 Still Not Working?

1. **Check browser console (F12):**
   - Look for CORS errors
   - Check what origin is being used

2. **Verify backend CORS:**
   ```bash
   curl -X OPTIONS \
     -H "Origin: http://localhost:5000" \
     -H "Access-Control-Request-Method: POST" \
     -I http://localhost:3000/api/v1/auth/register
   ```
   
   Should see `Access-Control-Allow-Origin` in the response

3. **Check what port Flutter web is using:**
   - Look at the browser address bar
   - Usually `http://localhost:5000` or `http://localhost:8080`
   - Make sure that port is in `CORS_ORIGIN`

