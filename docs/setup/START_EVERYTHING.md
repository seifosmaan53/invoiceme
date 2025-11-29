# 🚀 Start Everything - Step by Step

## ✅ Step 1: Start Backend (Terminal #1)

**Open a NEW terminal window** and run:

```bash
cd "/Users/seifosman/Desktop/invoice maker/backend"
npm run start:dev
```

### ✅ What to Look For

Wait for these messages:
```
✅ Swagger API documentation enabled at /api/docs
Application is running on: http://localhost:3000/api
```

### 🧪 Test Backend

Open in browser: **http://localhost:3000/api/health**

Should see JSON:
```json
{"status":"ok","timestamp":"...","uptime":...,"database":"connected",...}
```

**✅ If you see this → Backend is working!**

---

## ✅ Step 2: Start Flutter Web App (Terminal #2)

**Open a SECOND terminal window** and run:

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```

### ✅ What to Look For

1. **First time:** Takes 30-60 seconds to compile
2. **You'll see:**
   ```
   Launching lib/main.dart on Chrome in debug mode...
   Building web application...
   ```
3. **Chrome opens automatically** at a URL like:
   - `http://localhost:65102/`
   - `http://localhost:XXXXX/` (Flutter assigns the port)

### ⚠️ Important

- **Use the URL Flutter opens automatically** - don't force port 8080
- **Wait for compilation** - first run takes time
- **Keep this terminal open** - closing it stops the app

---

## ✅ Step 3: Test the App

1. **Browser should open automatically** with the app
2. **You should see:** Login/Register screen
3. **Try registering:**
   - Click "Create your account"
   - Fill in the form
   - Password must be **≥ 8 characters**
   - Click Register

### ✅ Success Indicators

- ✅ No "Connection Refused" errors
- ✅ Registration/login works
- ✅ Navigates to Dashboard after login
- ✅ Error messages are copyable (if any errors occur)

---

## 🔍 Troubleshooting

### Backend Issues

**"Port 3000 already in use"**
```bash
# Kill whatever is using port 3000
lsof -ti :3000 | xargs kill -9

# Then start backend again
cd backend && npm run start:dev
```

**"Cannot find module"**
```bash
cd backend
npm install
npm run start:dev
```

**Backend not responding**
- Check terminal for errors
- Verify PostgreSQL is running: `brew services list | grep postgresql`

### Flutter Issues

**"Connection refused" on localhost:8080**
- Don't use port 8080 unless you specify `--web-port 8080`
- Use the URL Flutter opens automatically
- Wait for compilation to finish

**"Flutter not found"**
```bash
# Check Flutter is installed
flutter doctor
```

**App crashes**
```bash
cd mobile
flutter clean
flutter pub get
flutter run -d chrome
```

---

## 📋 Quick Checklist

- [ ] **Terminal 1:** Backend running (`npm run start:dev`)
- [ ] **Backend test:** http://localhost:3000/api/health works
- [ ] **Terminal 2:** Flutter running (`flutter run -d chrome`)
- [ ] **Browser:** App loaded (login screen visible)
- [ ] **No errors:** No connection refused messages
- [ ] **Can register:** Form works, password ≥ 8 chars

---

## 🎯 Expected Flow

1. **Backend starts** → Port 3000 listening
2. **Flutter compiles** → Takes 30-60 seconds
3. **Browser opens** → Shows login screen
4. **Register/Login** → Works if backend is running
5. **Dashboard** → Appears after successful login

---

## 💡 Pro Tips

- **Keep both terminals open** while developing
- **Backend terminal** shows API requests/logs
- **Flutter terminal** shows app logs and hot reload
- **Browser console (F12)** shows client-side errors

---

## 🆘 Still Having Issues?

1. **Check backend:** `curl http://localhost:3000/api/health`
2. **Check Flutter:** Look at terminal output for errors
3. **Check browser console:** Press F12, look for errors
4. **Copy error messages:** They're now copyable in the app!

