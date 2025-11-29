# ⚡ Manual Launch Instructions

Since the automatic launch isn't working, here's how to start it manually:

## 🎯 Option 1: Run in Your Own Terminal (Recommended)

Open a **new terminal window** and run:

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```

This will show you the full output and open Chrome when ready.

## 🎯 Option 2: Use the Script

```bash
cd "/Users/seifosman/Desktop/invoice maker"
./start_mobile.sh
```

## 🎯 Option 3: Quick Command

Just copy and paste this entire command:

```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile" && flutter run -d chrome
```

## ⏳ What You'll See:

```
Launching lib/main.dart on Chrome in debug mode...
Compiling lib/main.dart for the Web...
[====================] 100%
Debug service listening on ws://127.0.0.1:XXXXX
Application running at http://localhost:XXXXX
```

Then Chrome will open with the login screen.

## 🔐 Login:

- Email: `seifosman53@gmail.com`
- Password: `Seif@5566`

## ✅ Backend Status:

- ✅ Backend is running: http://localhost:3000/api
- ✅ PostgreSQL is running
- ✅ Database is ready

**Just run one of the commands above in a new terminal window!**

