# Backend Server Startup Instructions

## 🚨 Current Status

There were multiple backend processes running but not responding on port 3000. I've cleaned them up and started a fresh instance.

## ✅ Steps to Start Backend

### Option 1: Let It Start Automatically (Recommended)

Wait 30-60 seconds, then check:
```bash
curl http://localhost:3000/api/docs
```

### Option 2: Manual Start (If Needed)

**Open a NEW terminal window** and run:

```bash
cd ~/Desktop/invoice\ maker/backend
npm run start:dev
```

### What to Look For:

**Success:**
```
Application is running on: http://localhost:3000/api
API Documentation available at: http://localhost:3000/api/docs
```

**Common Errors:**

1. **Database Connection Error:**
   ```
   Error: connect ECONNREFUSED 127.0.0.1:5432
   ```
   **Fix:** Start PostgreSQL:
   ```bash
   brew services start postgresql
   ```

2. **Port Already in Use:**
   ```
   Error: listen EADDRINUSE: address already in use :::3000
   ```
   **Fix:** Kill process on port 3000:
   ```bash
   lsof -ti:3000 | xargs kill -9
   ```

3. **Missing Dependencies:**
   ```
   Error: Cannot find module
   ```
   **Fix:** Install dependencies:
   ```bash
   npm install
   ```

## 🔍 Verify Backend is Running:

1. **Check port:**
   ```bash
   lsof -ti:3000
   ```
   Should return a process ID.

2. **Test API:**
   ```bash
   curl http://localhost:3000/api/v1/auth/login
   ```

3. **Open Swagger:**
   ```
   http://localhost:3000/api/docs
   ```

## 📝 Quick Checklist:

- [ ] PostgreSQL is running
- [ ] .env file exists with database credentials
- [ ] npm dependencies installed (`npm install`)
- [ ] Backend starts without errors
- [ ] Port 3000 is listening
- [ ] Swagger UI accessible at `/api/docs`

## ⏳ Wait Time

Backend takes 15-60 seconds to fully start, especially on first run.

**Check the terminal output for errors or success messages!**

Once you see "Application is running", the backend is ready!

