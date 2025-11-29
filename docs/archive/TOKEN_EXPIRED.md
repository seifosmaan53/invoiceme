# 🔐 Token Expired - Please Log In Again

## 🐛 Issue:

You're getting a **401 Unauthorized** error because your JWT token has **expired**.

The JWT tokens expire after **15 minutes** for security. This is why you're seeing the error.

## ✅ Quick Fix:

### Option 1: Logout and Login Again (Recommended)

1. **Go to Settings tab** (bottom right)
2. **Tap "Logout"**
3. **Login again** with:
   - Email: `seifosman53@gmail.com`
   - Password: `Seif@5566`

### Option 2: Refresh the Page

1. **Refresh the browser** (press `Cmd+R` or `F5`)
2. It will automatically redirect you to login
3. **Login again** with your credentials

## 🔍 Why This Happens:

- JWT tokens expire for security
- Access token expires after **15 minutes**
- Refresh token expires after **7 days**
- When tokens expire, you need to log in again

## 🎯 What I've Added:

1. ✅ **Auto-logout on 401**: When token expires, app shows "Session expired"
2. ✅ **Auto-redirect**: After 2 seconds, redirects to login screen
3. ✅ **Clear error message**: Shows "Session expired. Please log in again."

## 📝 Next Time:

To avoid this, I can add:
- **Auto-refresh**: Automatically refresh the access token using the refresh token
- **Token monitoring**: Check expiration before making requests
- **Silent refresh**: Refresh in background without user noticing

Would you like me to implement automatic token refresh?

## 🚀 For Now:

**Just log out and log in again**, and everything will work for another 15 minutes.

Go to **Settings** → **Logout** → **Login again**

