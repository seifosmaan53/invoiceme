# InvoiceMe Mobile App

Flutter mobile application for InvoiceMe invoice management system.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Lab: Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Cookbook: Useful Flutter samples](https://docs.flutter.dev/cookbook)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Environment Configuration

### Overview

The InvoiceMe mobile app uses environment-based configuration to connect to different backend API endpoints. This allows you to build different versions of the app for development, staging, and production environments.

### API URL Configuration

The app uses `--dart-define` for compile-time configuration of the API base URL. This ensures the correct API endpoint is compiled into each build.

#### Development

For local development, the app uses default localhost URLs based on the platform:

- **Web (Chrome)**: `http://localhost:3000/api/v1`
- **Android Emulator**: `http://10.0.2.2:3000/api/v1`
- **iOS Simulator**: `http://localhost:3000/api/v1`
- **Physical Device**: `http://<your-computer-ip>:3000/api/v1`

To run in development mode:
```bash
flutter run
```

#### Production

For production builds, use `--dart-define` to specify the production API URL:

**Web Production Build:**
```bash
flutter build web --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

**Android Production Build:**
```bash
flutter build apk --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

**iOS Production Build:**
```bash
flutter build ios --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

#### Staging

For staging environment:
```bash
flutter build web --release --dart-define=API_BASE_URL=https://staging-api.yourdomain.com/api/v1
```

#### Verification

After building, verify the API URL is correctly configured:

1. **Check Network Logs**: Open browser DevTools → Network tab → Look for API requests
2. **Test Login**: Attempt to log in and verify the request goes to the correct domain
3. **Inspect Build**: For web builds, check the compiled JavaScript for the API URL
4. **Flutter DevTools**: Use Flutter DevTools to inspect network requests

### Build Commands Reference

**Development:**
```bash
# Run in development mode (uses default localhost URLs)
flutter run

# Run with custom API URL
flutter run --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

**Production Builds:**
```bash
# Web production
flutter build web --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1

# Android production (APK)
flutter build apk --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1

# Android production (App Bundle for Play Store)
flutter build appbundle --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1

# iOS production
flutter build ios --release --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1
```

**Multiple Defines:**
You can pass multiple `--dart-define` flags for additional configuration:
```bash
flutter build web --release \
  --dart-define=API_BASE_URL=https://api.yourdomain.com/api/v1 \
  --dart-define=ENVIRONMENT=production
```

### API Timeout Configuration

The app supports configurable network timeouts for API requests. This is useful for slow networks or large file uploads.

**Default Timeouts:**
- Connection timeout: 30 seconds
- Receive timeout: 30 seconds

**Custom Timeouts:**
```bash
# Default timeouts (30 seconds)
flutter build apk --release --dart-define=API_BASE_URL=https://api.example.com/api/v1

# Custom timeouts for slow networks
flutter build apk --release \
  --dart-define=API_BASE_URL=https://api.example.com/api/v1 \
  --dart-define=API_CONNECT_TIMEOUT=60 \
  --dart-define=API_RECEIVE_TIMEOUT=60
```

**When to Adjust:**
- **Slow Networks**: Increase timeouts to 60-90 seconds for unreliable connections
- **Large File Uploads**: Increase receive timeout to 120+ seconds for large attachments
- **Development**: Default 30 seconds is usually sufficient

**Timeout Options:**
- `API_CONNECT_TIMEOUT`: Maximum time to establish connection (default: 30 seconds)
- `API_RECEIVE_TIMEOUT`: Maximum time to receive response (default: 30 seconds)

### Troubleshooting API Connection

#### "Cannot connect to backend"

1. **Verify API URL**: Check that the API URL is correctly configured using `--dart-define`
2. **Check Backend Status**: Ensure the backend server is running and accessible
3. **Network Connectivity**: Verify network connection (for physical devices, ensure they're on the same network)
4. **Firewall**: Check if firewall is blocking connections

#### "CORS error"

CORS (Cross-Origin Resource Sharing) errors occur when the backend doesn't allow requests from your app's origin.

- **Web builds**: Require CORS configuration on the backend. See [DEPLOYMENT.md](../DEPLOYMENT.md) for CORS setup
- **Native mobile apps**: Don't require CORS (only web builds do)
- **Solution**: Configure `CORS_ORIGIN` in backend `.env` file to include your app's domain

#### "Network error"

1. **Check API URL format**: Must start with `http://` or `https://` and end with `/api/v1`
2. **SSL Certificate**: For production, ensure SSL certificate is valid
3. **Network Settings**: Check firewall, proxy, or VPN settings
4. **Backend Logs**: Check backend logs for connection attempts

#### Inspecting Network Requests

**Flutter DevTools:**
1. Run app with `flutter run`
2. Open DevTools: `flutter pub global run devtools`
3. Navigate to Network tab to see all API requests

**Browser DevTools (Web builds):**
1. Open browser DevTools (F12)
2. Navigate to Network tab
3. Filter by "XHR" or "Fetch" to see API requests
4. Check request URL, headers, and response

### CORS Configuration

**Important**: Web builds of Flutter apps require CORS configuration on the backend. Native iOS and Android apps do not need CORS.

For web builds, ensure your backend `CORS_ORIGIN` environment variable includes your app's domain:

```env
# Single domain
CORS_ORIGIN=https://app.yourdomain.com

# Multiple domains
CORS_ORIGIN=https://app.yourdomain.com,https://mobile.yourdomain.com
```

See [DEPLOYMENT.md](../DEPLOYMENT.md) for detailed CORS configuration instructions.
