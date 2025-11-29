# Backend Server Startup Guide

## 🚨 Issue: Backend Not Running

Safari can't connect because the backend server isn't running on port 3000.

## ✅ Starting Backend Server

I've started the backend server. Wait a few seconds for it to initialize.

### Check Backend Status:

**In a new terminal, run:**
```bash
curl http://localhost:3000/api/docs
```

If you see HTML output, the backend is running!

### Manual Start (if needed):

**Open a NEW terminal window** and run:

```bash
cd ~/Desktop/invoice\ maker/backend

# Install dependencies (if needed)
npm install

# Start the server
npm run start:dev
```

### Expected Output:

```
Application is running on: http://localhost:3000/api
API Documentation available at: http://localhost:3000/api/docs
```

### Verify Backend is Running:

1. **Check if port 3000 is in use:**
   ```bash
   lsof -ti:3000
   ```
   If it returns a number, backend is running!

2. **Test API endpoint:**
   ```bash
   curl http://localhost:3000/api/v1/auth/login
   ```

3. **Open Swagger UI:**
   ```
   http://localhost:3000/api/docs
   ```

### Common Issues:

1. **Database not running:**
   ```bash
   # Check PostgreSQL
   psql -U postgres -c "SELECT version();"
   ```

2. **Missing .env file:**
   ```bash
   cd backend
   cp env.example .env
   # Edit .env with database credentials
   ```

3. **Port already in use:**
   ```bash
   # Kill process on port 3000
   lsof -ti:3000 | xargs kill -9
   ```

### After Backend Starts:

1. **Verify:** Open `http://localhost:3000/api/docs` in Safari
2. **Restart Flutter:** Press `R` in Flutter terminal for hot restart
3. **Try login again** - connection error should be resolved!

## ⏳ Wait Time

Backend typically takes 10-30 seconds to start. Check the terminal for:
- "Application is running on: http://localhost:3000/api"
- Any error messages about database connection

Once you see "Application is running", the backend is ready!

