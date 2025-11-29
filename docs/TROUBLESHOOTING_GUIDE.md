# 🔧 Troubleshooting Guide

Common issues and solutions for InvoiceMe.

---

## Table of Contents

1. [Login Issues](#login-issues)
2. [Connection Problems](#connection-problems)
3. [Data Sync Issues](#data-sync-issues)
4. [Invoice Problems](#invoice-problems)
5. [Performance Issues](#performance-issues)
6. [Backup & Restore](#backup--restore)
7. [Restarting Services](#restarting-services)

---

## Login Issues

### "Invalid email or password"

**Possible Causes:**
- Typo in email or password
- Account doesn't exist
- Password was changed

**Solutions:**
1. Double-check your email and password
2. Use "Forgot Password" to reset
3. Verify you're using the correct account

### "Token expired" or "Please log in again"

**Cause:** Your session expired for security reasons.

**Solution:**
1. Simply log in again
2. Your data is safe - nothing is lost
3. Sessions expire after inactivity for security

### Can't log in after app update

**Solution:**
1. Clear app cache (Settings → Apps → InvoiceMe → Clear Cache)
2. Restart the app
3. Try logging in again

---

## Connection Problems

### "Network error" or "Unable to connect"

**Possible Causes:**
- Backend server is not running
- Incorrect API URL configuration
- Network connectivity issue
- CORS configuration (web only)

**Solutions:**

#### Check Backend Status
```bash
# Check if backend is running
curl http://localhost:3000/health

# Should return: {"status":"ok"}
```

#### Restart Backend
```bash
cd backend
npm run start:dev
```

#### Check API URL
1. Go to **Settings**
2. Verify **API Base URL** is correct
3. For local development: `http://localhost:3000`
4. For production: Your server URL

#### Web-Specific (CORS)
If using Flutter Web:
1. Check backend `.env` file
2. Ensure `CORS_ORIGIN` includes your web URL
3. Example: `CORS_ORIGIN=http://localhost:8080,https://yourdomain.com`
4. Restart backend after changing

#### Network Issues
1. Check internet connection
2. Try a different network (WiFi vs mobile data)
3. Check firewall settings
4. Verify backend is accessible from your device

---

## Data Sync Issues

### Changes not appearing on other devices

**Possible Causes:**
- Device is offline
- Sync service not running
- Network issues

**Solutions:**
1. **Pull to refresh** - Swipe down on the screen
2. Check internet connection
3. Wait a few seconds - sync happens automatically
4. Restart the app

### "Sync failed" error

**Solution:**
1. Check internet connection
2. Verify backend is running
3. Pull to refresh
4. If persists, restart the app

### Offline changes not syncing

**Solution:**
1. Ensure device is online
2. Open the app - sync happens automatically
3. Pull to refresh to force sync
4. Check sync status in Settings

---

## Invoice Problems

### Can't create invoice

**Possible Causes:**
- Missing required fields
- Client not selected
- Validation errors

**Solutions:**
1. Ensure **Client** is selected (required)
2. Add at least one **Item** with description
3. Check all required fields are filled
4. Review error messages for specific issues

### Invoice totals are wrong

**Solution:**
1. Check item quantities and prices
2. Verify tax rates are percentages (e.g., 10 for 10%)
3. Check discount calculations
4. Use **Preview** before saving to verify

### Can't edit invoice

**Cause:** Only **DRAFT** invoices can be edited.

**Solution:**
1. If invoice is already sent, **Duplicate** it instead
2. Edit the duplicate
3. Or create a new invoice

### PDF generation fails

**Solutions:**
1. Check internet connection (PDF is generated server-side)
2. Verify backend is running
3. Try again - may be temporary server issue
4. Check backend logs for errors

---

## Performance Issues

### App is slow

**Solutions:**
1. **Clear cache:**
   - Settings → Apps → InvoiceMe → Clear Cache
2. **Restart app**
3. **Check device storage** - free up space if needed
4. **Update app** - newer versions may have performance fixes

### List takes long to load

**Solutions:**
1. Use **search** to filter results
2. Pull to refresh
3. Check internet connection
4. Large datasets may take a moment - be patient

### Dashboard not loading

**Solutions:**
1. Pull to refresh
2. Check internet connection
3. Restart app
4. Verify backend is running

---

## Backup & Restore

### Backing Up Data

**Automatic Backups:**
- Backend creates daily database backups (if configured)
- Check backend logs for backup location

**Manual Backup:**
```bash
# Connect to your server
cd /path/to/backend

# Create backup
pg_dump -U your_user -d your_database > backup_$(date +%Y%m%d).sql
```

### Restoring from Backup

```bash
# Restore database
psql -U your_user -d your_database < backup_YYYYMMDD.sql

# Restart backend
npm run start:dev
```

### Exporting Data

**Export Invoices:**
1. Go to **Invoices** tab
2. Share individual invoices as PDF
3. Or use backend API to export in bulk

**Export Clients:**
- Use backend API endpoint: `GET /clients`
- Or share client details manually

---

## Restarting Services

### Restart Backend

```bash
# Stop backend (Ctrl+C if running in terminal)

# Start backend
cd backend
npm run start:dev

# Or in production
npm run start:prod
```

### Restart Database (PostgreSQL)

```bash
# Linux/Mac
sudo systemctl restart postgresql

# Or using Docker
docker-compose restart postgres
```

### Restart Everything (Docker)

```bash
# Stop all services
docker-compose down

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f
```

### Clear App Data (Mobile)

**Android:**
1. Settings → Apps → InvoiceMe
2. Storage → Clear Data
3. Restart app

**iOS:**
1. Delete and reinstall app
2. Or: Settings → General → iPhone Storage → InvoiceMe → Offload App

---

## Common Error Messages

### "401 Unauthorized"

**Meaning:** Your session expired or token is invalid.

**Solution:** Log in again.

### "404 Not Found"

**Meaning:** Resource doesn't exist or URL is wrong.

**Solution:**
- Check if item was deleted/archived
- Verify API URL is correct
- Check backend is running

### "500 Internal Server Error"

**Meaning:** Server-side error.

**Solution:**
1. Check backend logs
2. Restart backend
3. Verify database is running
4. Contact support if persists

### "Network Error"

**Meaning:** Can't reach the server.

**Solution:**
1. Check internet connection
2. Verify backend is running
3. Check API URL in settings
4. Try again in a moment

---

## Getting More Help

### Check Logs

**Backend Logs:**
```bash
cd backend
npm run start:dev
# Logs appear in terminal
```

**Flutter App Logs:**
- Check console/terminal where app is running
- Look for error messages with ❌ or ⚠️

### Debug Mode

**Enable Debug Logging:**
1. Check backend `.env` - ensure `NODE_ENV=development`
2. Flutter app logs automatically in debug mode

### Still Having Issues?

1. **Check this guide** - Most issues are covered here
2. **Review error messages** - They often indicate the problem
3. **Check backend status** - Ensure services are running
4. **Restart services** - Often fixes temporary issues
5. **Contact support** - Provide error messages and steps to reproduce

---

## Quick Reference

### Health Check
```bash
curl http://localhost:3000/health
```

### Check Backend Status
```bash
cd backend
npm run start:dev
```

### Restart Backend
```bash
cd backend
npm run start:dev
```

### View Database
```bash
psql -U your_user -d your_database
```

### Clear App Cache
- Android: Settings → Apps → InvoiceMe → Clear Cache
- iOS: Delete and reinstall

---

**Last Updated:** January 2025  
**Version:** 1.0.0

