# ✅ Complete Setup Steps - Fix Network Error

## Step 1: Start Backend

**Open Terminal #1:**
```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

**Wait for:**
```
✅ Swagger API documentation enabled at /api/docs
Application is running on: http://localhost:3000/api
```

**⚠️ Keep this terminal open!**

## Step 2: Test Backend in Browser

**Open Chrome and test:**

1. **Health Check:** http://localhost:3000/api/health
   - Should return: `{"status":"ok","database":"connected",...}`

2. **Swagger UI:** http://localhost:3000/api/docs
   - Should see the API documentation page

**✅ If both work → Backend is good!**

**❌ If either fails → Fix backend first (check terminal for errors)**

## Step 3: Verify Flutter Base URL

**Check:** `mobile/lib/core/services/api_client.dart`

**Should have:**
```dart
static String _getDefaultBaseUrl() {
  if (kIsWeb) {
    return 'http://localhost:3000/api/v1';  // ✅ Correct
  } else {
    // ... mobile platforms
  }
}
```

**✅ Already correct!** (Verified in code)

## Step 4: CORS Configuration

**✅ Already fixed!** CORS is now very permissive for development:
- Allows all origins in development mode
- No CORS blocking for localhost

**After backend restart, CORS will be permissive.**

## Step 5: Restart Flutter Cleanly

**In Terminal #2 (or stop current Flutter and restart):**

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter clean
flutter pub get
flutter run -d chrome
```

**Wait for Chrome to open automatically.**

## Step 6: Test Registration/Login

1. **Hard refresh browser:** `Cmd + Shift + R`
2. **Try registering** with:
   - Email: `test@example.com`
   - Password: `password123` (8+ characters)
   - Name: `Test User`
3. **Should work now!**

## 🔍 Debugging: If Still Failing

### Check Network Tab (F12)

1. Open browser DevTools (F12)
2. Go to **Network** tab
3. Try registering
4. Find the failed request (usually `/auth/register`)
5. **Check:**
   - **Request URL:** Should be `http://localhost:3000/api/v1/auth/register`
   - **Status:** 
     - `200` = Success ✅
     - `400/401/409` = API error (different issue)
     - `(failed)` = Connection error (backend not running)

### Verify Backend is Running

```bash
# Check if backend is listening
lsof -i :3000

# Test health endpoint
curl http://localhost:3000/api/health
```

### Check Flutter Console

Look for:
```
🌐 API Base URL: http://localhost:3000/api/v1
```

**Should match:** `http://localhost:3000/api/v1`

## 📋 Quick Checklist

- [ ] **Backend running:** Terminal shows "Application is running on: http://localhost:3000/api"
- [ ] **Health check works:** http://localhost:3000/api/health returns JSON
- [ ] **Swagger works:** http://localhost:3000/api/docs opens
- [ ] **Flutter base URL:** `http://localhost:3000/api/v1` (check console)
- [ ] **CORS permissive:** Development mode allows all origins
- [ ] **Flutter app refreshed:** Hard refresh (`Cmd + Shift + R`)

## 🎯 Expected Result

Once all steps are done:
- ✅ No "Network error" messages
- ✅ Registration/login works
- ✅ App connects to API successfully
- ✅ Can create invoices, clients, etc.

## 🆘 Still Not Working?

**Copy these for debugging:**

1. **Backend terminal output:**
   - Look for: `Application is running on: ...`

2. **Flutter console:**
   - Look for: `🌐 API Base URL: ...`

3. **Browser Network tab:**
   - Failed request URL
   - Status code (if any)

**With these, I can pinpoint the exact mismatch!**

