# 🔍 Enhanced Debugging - Full Request/Response Logging

## ✅ Added LogInterceptor:

I've added **LogInterceptor** to Dio which will show:

- ✅ **Request URL** (full path)
- ✅ **Request Method** (POST, GET, etc.)
- ✅ **Request Headers** (Content-Type, Authorization, etc.)
- ✅ **Request Body** (exact JSON being sent)
- ✅ **Response Status Code** (200, 400, etc.)
- ✅ **Response Body** (exact JSON response)
- ✅ **Error Details** (if any)

## 🚀 After Restarting the App:

1. **Restart Flutter app** (press `R` or restart)
2. **Open browser console** (F12 → Console tab)
3. **Try registering** - you'll see FULL request/response logs!

## 📋 What You'll See in Console:

```
[log] Request: POST http://localhost:3000/api/v1/auth/register
[log] Request Headers: {Content-Type: application/json}
[log] Request Body: {"email":"test@example.com","password":"password123","name":"Test User"}
[log] Response: 400 Bad Request
[log] Response Body: {"statusCode":400,"message":["property company_name should not exist"],...}
```

## 🔍 This Will Show:

1. **Exact URL** being called
2. **Exact JSON** being sent (check for `companyName` vs `company_name`)
3. **Exact error** from backend
4. **Which field** is causing the problem

## ✅ Expected Request (After Fix):

Should see:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name"
}
```

**OR** if company name provided:
```json
{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name",
  "companyName": "Company Name"
}
```

## ❌ If You Still See:

```json
{
  "company_name": "..."  // ❌ Wrong - will cause 400
}
```

Then the app hasn't restarted properly - try full restart (`q` then `flutter run -d chrome`)

## 🎯 Steps:

1. **Restart app** (CRITICAL!)
2. **Open console** (F12)
3. **Try registering**
4. **Copy the FULL log** from console (especially Request Body and Response Body)
5. **Share it here** so I can see exactly what's being sent!

**The detailed logs will show us exactly what's wrong!**

