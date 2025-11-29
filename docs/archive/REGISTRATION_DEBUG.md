# 🔍 Debugging Registration 400 Error

## 🐛 Error Found:

Backend logs show:
```
'message': [ 'property company_name should not exist' ]
```

The backend is rejecting `company_name` because:
- ValidationPipe has `forbidNonWhitelisted: true`
- DTO expects `companyName` (camelCase), not `company_name` (snake_case)

## ✅ Fix Applied:

1. **Updated auth_service.dart** to use `companyName` (camelCase)
2. **Added debug logging** to see what's being sent
3. **Only include companyName if it's not null/empty**

## 🚀 CRITICAL: Restart Flutter App

**You MUST restart the Flutter app for changes to take effect:**

1. **Stop the app:** Press `q` in Flutter terminal
2. **Restart:** `flutter run -d chrome`
3. **OR Hot Restart:** Press `R` (capital R) in Flutter terminal

## 🔍 Debug Steps:

After restarting, check the browser console (F12 → Console) for:
```
API POST /auth/register: {email: ..., password: ..., name: ..., companyName: ...}
```

This will show exactly what's being sent.

## ✅ Expected Request Format:

```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name",
  "companyName": "Optional Company"  // Only if provided
}
```

NOT:
```json
{
  "company_name": "..."  // ❌ Wrong - will cause 400 error
}
```

## 🎯 Try Again:

1. **Restart Flutter app** (CRITICAL!)
2. **Try registering** with a new email
3. **Check browser console** for debug logs
4. **Should work now!**

**The fix is in place - just restart the app to apply it!**

