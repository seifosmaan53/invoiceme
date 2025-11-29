# 🚨 Connection Error - Backend Not Running

## Problem

The Flutter app is trying to connect to `http://localhost:3000/api/v1` but the backend server isn't running.

## ✅ Solution

### Start the Backend Server

**Open a NEW terminal window** and run:

```bash
cd ~/Desktop/invoice\ maker/backend
npm run start:dev
```

### Expected Output:

```
Application is running on: http://localhost:3000/api
API Documentation available at: http://localhost:3000/api/docs
```

### Verify Backend is Running:

1. **Open in browser:**
   ```
   http://localhost:3000/api/docs
   ```
   
   You should see Swagger UI documentation.

2. **Test API:**
   ```bash
   curl http://localhost:3000/api/v1/auth/login
   ```

### After Backend Starts:

1. **In Flutter terminal** (where app is running):
   - Press `R` for hot restart
   - Or press `q` to quit, then run: `flutter run -d chrome`

2. **Try login again** - connection error should be gone!

## 🔧 If Backend Won't Start:

### Check Database:
```bash
# Make sure PostgreSQL is running
psql -U postgres -c "SELECT version();"
```

### Check Environment:
```bash
cd ~/Desktop/invoice\ maker/backend
cat .env  # Make sure database credentials are set
```

### Common Issues:

1. **Database not running:**
   ```bash
   # Start PostgreSQL (macOS)
   brew services start postgresql
   ```

2. **Missing .env file:**
   ```bash
   cp env.example .env
   # Edit .env with your database credentials
   ```

3. **Port already in use:**
   ```bash
   lsof -ti:3000 | xargs kill -9
   ```

## ✅ Quick Start Commands:

```bash
# Terminal 1: Start Backend
cd ~/Desktop/invoice\ maker/backend
npm run start:dev

# Terminal 2: Run Flutter App (already running)
# Just press 'R' for hot restart once backend is up
```

## 🎯 Status:

- ✅ Backend server starting...
- ⏳ Wait for "Application is running" message
- 🔄 Then restart Flutter app (`R` for hot restart)
- ✅ Connection error should be resolved!

**The backend needs to be running before the Flutter app can connect!**

