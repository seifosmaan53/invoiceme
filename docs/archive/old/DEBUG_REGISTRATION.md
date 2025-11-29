# 🔍 Debug Registration Issues

## Common Registration Problems

### 1. Password Length Mismatch
- **Backend requires**: Minimum 8 characters
- **Mobile app now validates**: Minimum 8 characters ✅
- **Fix**: Updated password validation to match backend

### 2. Network Errors
- Check if backend is running: `curl http://localhost:3000/api/health`
- Check CORS settings if using web build
- Verify API URL is correct

### 3. Validation Errors
- Email must be valid format
- Password must be at least 8 characters
- Name is required
- Company name is optional

### 4. Email Already Registered
- Error code: 409
- Message: "This email is already registered. Please login instead."

## How to Debug

1. **Check Browser Console** (if using web):
   - Open DevTools (F12)
   - Look for error messages in Console tab
   - Check Network tab for failed requests

2. **Check Backend Logs**:
   ```bash
   # Backend logs should show registration attempts
   # Look for validation errors or exceptions
   ```

3. **Test Registration via API**:
   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/register \
     -H "Content-Type: application/json" \
     -d '{
       "email": "test@example.com",
       "password": "password123",
       "name": "Test User"
     }'
   ```

4. **Check Mobile App Logs**:
   - Look for "Register request data" in console
   - Look for "Register response" or "Registration error" messages
   - Check for HTTP status codes (400, 409, 500, etc.)

## Expected Registration Flow

1. User fills form (name, email, password ≥8 chars)
2. Form validates client-side
3. Keyboard dismisses
4. Request sent to `/api/v1/auth/register`
5. Backend validates (email format, password length, etc.)
6. Backend creates user and returns tokens
7. Mobile app saves tokens and navigates to dashboard

## If Registration Still Fails

1. **Check the error message** - it should be copyable now
2. **Check browser/console logs** for detailed error info
3. **Verify backend is running** and database is connected
4. **Check if email already exists** in database
5. **Try a different email** to test if it's email-specific

