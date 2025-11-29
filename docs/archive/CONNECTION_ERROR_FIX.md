# Connection Error Fix Guide

## 🚨 Error: DioException Connection Error

This error means the Flutter app can't connect to the backend API.

### Possible Causes:

1. **Backend not running** - Most common issue
2. **Wrong API URL** - Port mismatch or incorrect address
3. **CORS issues** - Backend not configured for web requests
4. **Network connectivity** - Firewall or network blocking

## ✅ Quick Fixes:

### 1. Check if Backend is Running

```bash
cd ~/Desktop/invoice\ maker/backend
npm run start:dev
```

You should see:
```
Application is running on: http://localhost:3000/api
```

### 2. Verify Backend is Accessible

Open in browser:
```
http://localhost:3000/api/docs
```

If Swagger UI loads, backend is running correctly.

### 3. Check API URL in Flutter App

The API URL is set in:
`mobile/lib/core/services/api_client.dart` (line 11)

Current setting:
```dart
_baseUrl = 'http://localhost:3000/api/v1';
```

### 4. For Web (Chrome) - Use localhost

When running in Chrome, `localhost:3000` should work.

### 5. Start Backend Server

If backend isn't running:

```bash
cd ~/Desktop/invoice\ maker/backend

# Make sure dependencies are installed
npm install

# Start the server
npm run start:dev
```

### 6. Verify Backend Endpoints

Test the backend is working:
```bash
curl http://localhost:3000/api/v1/auth/login
```

Should return a response (even if it's an error about missing credentials).

## 🔧 Troubleshooting Steps:

1. **Start Backend:**
   ```bash
   cd ~/Desktop/invoice\ maker/backend
   npm run start:dev
   ```

2. **Verify Backend is Running:**
   - Check terminal shows: "Application is running on: http://localhost:3000/api"
   - Open: http://localhost:3000/api/docs (Swagger UI)

3. **Restart Flutter App:**
   - In Flutter terminal, press `R` for hot restart
   - Or quit (`q`) and run again: `flutter run -d chrome`

4. **Check CORS Settings:**
   - Backend should have CORS enabled for `localhost` origins
   - Check `backend/src/main.ts` for CORS configuration

## 📝 Expected Flow:

1. ✅ Backend running on `http://localhost:3000`
2. ✅ Flutter app connects to `http://localhost:3000/api/v1`
3. ✅ Login request succeeds
4. ✅ App loads dashboard

## 🎯 Next Steps:

1. Start the backend server
2. Verify it's accessible
3. Restart Flutter app
4. Try login again

The connection error should resolve once the backend is running!

