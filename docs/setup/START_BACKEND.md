# 🚀 Start the Backend - Step by Step

## The Problem
Your backend is **not running**, which is why you're getting "connection refused".

## ✅ Quick Start

### Step 1: Open a Terminal

Open a **new terminal window** (keep it open - you'll see backend logs here).

### Step 2: Navigate to Backend

```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
```

### Step 3: Start the Backend

```bash
npm run start:dev
```

## ✅ What You Should See

Wait for these messages:

```
✅ Swagger API documentation enabled at /api/docs
Application is running on: http://localhost:3000/api
```

**⚠️ IMPORTANT:** Don't close this terminal! The backend needs to keep running.

## 🧪 Test It Works

In a **new terminal**, test:

```bash
curl http://localhost:3000/api/health
```

Should return JSON with `"status":"ok"`.

## 🔄 Then Refresh Your Flutter App

1. Go back to your Flutter web app in the browser
2. **Hard refresh:** `Cmd + Shift + R` (Mac) or `Ctrl + Shift + R` (Windows)
3. Try registering/login again

## ⚠️ If You See Errors

### "Port 3000 already in use"
```bash
# Kill whatever is using port 3000
lsof -ti :3000 | xargs kill -9

# Then start backend again
npm run start:dev
```

### "Cannot find module"
```bash
# Install dependencies first
npm install

# Then start
npm run start:dev
```

### "Database connection error"
```bash
# Start PostgreSQL
brew services start postgresql@14

# Wait a few seconds, then start backend
npm run start:dev
```

## 📋 Summary

1. ✅ Open terminal
2. ✅ `cd backend`
3. ✅ `npm run start:dev`
4. ✅ Wait for "Application is running"
5. ✅ Refresh Flutter app
6. ✅ Try login/register

The backend **must be running** for your Flutter app to work!

