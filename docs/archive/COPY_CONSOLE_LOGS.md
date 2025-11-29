# 🔍 Checking Console Logs

## ✅ What I See:

You're getting a 400 error, but I need to see the **LogInterceptor output** which should show:

1. **Request Body** - What JSON is being sent
2. **Response Body** - What error the backend is returning

## 🔍 Look for These Logs in Console:

The LogInterceptor should print lines like:

```
[log] Request: POST http://localhost:3000/api/v1/auth/register
[log] Request Headers: {Content-Type: application/json}
[log] Request Body: {"email":"...","password":"...","name":"..."}
[log] Response: 400 Bad Request
[log] Response Body: {"statusCode":400,"message":[...],...}
```

## 📋 What to Copy:

**Please copy and paste:**

1. **The line that says "Request Body:"** - This shows what JSON is being sent
2. **The line that says "Response Body:"** - This shows the error message

**OR** scroll down in the console and look for:
- Any line containing `"company_name"` (wrong - should be `companyName`)
- Any line containing `"message"` (shows validation errors)

## 🎯 Quick Check:

In the browser console, search for:
- `company_name` - If you see this, the app hasn't restarted properly
- `Request Body` - Shows what's being sent
- `Response Body` - Shows the error

## ✅ Expected Request Body (After Fix):

Should be:
```json
{"email":"...","password":"...","name":"..."}
```

OR if company name provided:
```json
{"email":"...","password":"...","name":"...","companyName":"..."}
```

## ❌ If You See:

```json
{"company_name":"..."}  // ❌ Wrong - will cause 400
```

Then the app needs to be restarted.

**Please copy the Request Body and Response Body lines from the console!**

