# 🔐 Clear Expired Token and Restart

## 🐛 Problem:

Hot restart (`R`) doesn't clear the expired token from storage. The old expired token is still being used.

## ✅ Quick Solutions:

### Option 1: Force Logout via Settings (Easiest)

1. **Look at the bottom navigation bar**
2. **Tap the "Settings" icon** (far right)
3. **Scroll down and tap "Logout"**
4. **Login again** with:
   - Email: `seifosman53@gmail.com`
   - Password: `Seif@5566`

### Option 2: Clear Browser Data

1. **Open Chrome DevTools** (press F12)
2. **Go to Application tab** → Storage
3. **Click "Clear site data"** button
4. **Refresh the page** (F5 or Cmd+R)
5. **Login again**

### Option 3: Full App Restart (Terminal)

In the terminal where Flutter is running:

1. **Press `q`** to quit the app
2. **Run again:**
```bash
cd "/Users/seifosman/Desktop/invoice maker/mobile"
flutter run -d chrome
```
3. **Login again**

### Option 4: Clear Storage via Console (Fastest)

In Chrome console (F12 → Console tab), paste this:

```javascript
localStorage.clear();
sessionStorage.clear();
location.reload();
```

Then login again.

## 🎯 After Logging In:

Your invoices will load correctly:
- ✅ Fresh token (valid for 15 minutes)
- ✅ Invoice list will load
- ✅ You'll see INV-2025-0001 ($417.56)

## 🔧 Want Auto-Refresh?

I can implement automatic token refresh so you don't have to log in every 15 minutes. Would you like me to add that feature?

**For now: Go to Settings → Logout → Login again**

