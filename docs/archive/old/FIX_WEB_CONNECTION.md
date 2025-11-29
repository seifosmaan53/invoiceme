# 🔧 Quick Fix for Web Connection Error

## The Problem
You're seeing: `DioException [connection error]: The XMLHttpRequest onError callback was called`

This is a **CORS (Cross-Origin Resource Sharing)** issue - your web app can't connect to the backend.

## ✅ Quick Fix (3 Steps)

### Step 1: Check Backend .env File

```bash
cd backend
# If .env doesn't exist, create it:
cp env.example .env
```

### Step 2: Set CORS_ORIGIN

Edit `backend/.env` and add/update this line:

```bash
# Allow all localhost origins for development
CORS_ORIGIN=http://localhost:3000,http://localhost:8080,http://localhost:5000,http://127.0.0.1:3000,http://127.0.0.1:8080,http://127.0.0.1:5000

# OR for development only (not production!):
CORS_ORIGIN=*
```

### Step 3: Restart Backend

```bash
# Stop the backend (Ctrl+C)
# Then restart:
cd backend
npm run start:dev
```

## 🧪 Test It

1. **Check backend is running:**
   ```bash
   curl http://localhost:3000/api/health
   ```

2. **Check browser console:**
   - Open DevTools (F12)
   - Look for: `🌐 API Base URL: http://localhost:3000/api/v1`
   - Try logging in again

3. **If still not working:**
   - Check browser console for CORS errors
   - Verify the exact origin in the error message
   - Add that origin to `CORS_ORIGIN` in backend/.env

## 📋 Common Flutter Web Ports

Flutter web typically runs on:
- `http://localhost:5000` (default)
- `http://localhost:8080` (if specified)
- `http://localhost:3000` (if backend port conflicts)

Make sure **all** these ports are in your `CORS_ORIGIN`:

```bash
CORS_ORIGIN=http://localhost:3000,http://localhost:5000,http://localhost:8080,http://127.0.0.1:3000,http://127.0.0.1:5000,http://127.0.0.1:8080
```

## 🔍 Debug Steps

1. **Check what origin your web app is using:**
   - Open browser console (F12)
   - Look at the Network tab
   - Find the failed request
   - Check the "Origin" header

2. **Verify backend CORS:**
   ```bash
   # Check backend logs when you try to connect
   # Should see CORS-related messages
   ```

3. **Test with curl:**
   ```bash
   # Test if backend responds
   curl -v http://localhost:3000/api/health
   
   # Test CORS headers
   curl -H "Origin: http://localhost:5000" \
        -H "Access-Control-Request-Method: POST" \
        -X OPTIONS \
        http://localhost:3000/api/v1/auth/login
   ```

## ⚠️ Important Notes

- **Development:** Using `CORS_ORIGIN=*` is OK for local development
- **Production:** NEVER use `*` - specify exact domains
- **After changing .env:** Always restart the backend
- **Browser cache:** Sometimes you need to hard refresh (Ctrl+Shift+R)

## 🎯 Still Not Working?

1. Check `WEB_CONNECTION_TROUBLESHOOTING.md` for detailed steps
2. Check browser console for specific error messages
3. Verify backend is actually running on port 3000
4. Try a different browser (Chrome, Firefox, Safari)

