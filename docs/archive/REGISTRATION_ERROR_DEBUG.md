# 🔍 Better Error Messages for Registration

## ✅ Improvements Made:

1. **Better error handling** - Shows actual validation errors from backend
2. **Debug logging** - Logs request data and error responses
3. **Clearer error messages** - Shows what field failed validation

## 🚨 Important: Check Browser Console

After restarting the app, check the browser console (F12 → Console) for:

```
Register request data: {email: ..., password: ..., name: ...}
API Error 400: {message: [...], ...}
```

This will show:
- **What's being sent** (check for `companyName` not `company_name`)
- **What the backend is rejecting**

## 🔍 Common Validation Errors:

1. **Password too short:**
   - Backend requires minimum 8 characters
   - Error: `password must be longer than or equal to 8 characters`

2. **Invalid email:**
   - Error: `email must be an email`

3. **Missing fields:**
   - Error: `name should not be empty`

4. **Wrong field name:**
   - Error: `property company_name should not exist`
   - Fix: Restart app to use `companyName`

## 🚀 Steps to Debug:

1. **Restart Flutter app** (press `R` or restart)
2. **Open browser console** (F12 → Console)
3. **Try registering** with:
   - Email: Valid email format
   - Password: **At least 8 characters**
   - Name: Any name
   - Company Name: (leave empty)
4. **Check console** for error details
5. **Read the error message** - it tells you exactly what's wrong!

## ✅ Expected Console Output:

**Success:**
```
Register request data: {email: user@example.com, password: password123, name: User Name}
```

**Error (with details):**
```
Register request data: {email: ..., password: ..., name: ...}
API Error 400: {message: ['password must be longer than or equal to 8 characters']}
```

**Check the console to see exactly what's wrong!**

