import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb, kDebugMode, defaultTargetPlatform, debugPrint;
import 'package:flutter/services.dart' show TargetPlatform;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ApiClient {
  late Dio _dio;
  String? _baseUrl;
  String? _accessToken;
  final FlutterSecureStorage? _secureStorage = kIsWeb ? null : const FlutterSecureStorage();

  ApiClient() {
    // Get the base URL with environment detection and fallback logic
    const apiBaseUrlEnv = String.fromEnvironment('API_BASE_URL');
    _baseUrl = apiBaseUrlEnv.isNotEmpty ? apiBaseUrlEnv : _getDefaultBaseUrl();

    // Validate base URL format
    _validateBaseUrl(_baseUrl!);

    // Timeouts configurable via --dart-define:
    // flutter build apk --dart-define=API_CONNECT_TIMEOUT=60 --dart-define=API_RECEIVE_TIMEOUT=60
    final connectTimeoutSeconds = const int.fromEnvironment('API_CONNECT_TIMEOUT', defaultValue: 30);
    final receiveTimeoutSeconds = const int.fromEnvironment('API_RECEIVE_TIMEOUT', defaultValue: 30);

    // Log active base URL and timeouts in debug mode
    if (kDebugMode) {
      debugPrint('API Base URL: $_baseUrl');
    }
    _dio = Dio(BaseOptions(
      baseUrl: _baseUrl!,
      headers: {
        'Content-Type': 'application/json',
      },
      connectTimeout: Duration(seconds: connectTimeoutSeconds),
      receiveTimeout: Duration(seconds: receiveTimeoutSeconds),
    ));

    // Add logging interceptor to see exact request/response
    _dio.interceptors.add(LogInterceptor(
      requestBody: true,
      responseBody: true,
      requestHeader: true,
      responseHeader: false,
      error: true,
      logPrint: (obj) {
        if (kIsWeb) {
          print(obj); // Print to browser console
        }
      },
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        // Attach token to request if available
        // Token should already be loaded in _loadToken() or set via setToken()
        if (_accessToken != null && _accessToken!.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $_accessToken';
        }
        
        // Log request details for web debugging (only in debug mode)
        if (kIsWeb && kDebugMode) {
          debugPrint('API Request: ${options.method} ${options.baseUrl}${options.path}');
        }
        return handler.next(options);
      },
      onError: (error, handler) async {
        // Enhanced error logging for web (only in debug mode)
        if (kIsWeb && kDebugMode) {
          debugPrint('API Error: ${error.type} - ${error.message}');
          debugPrint('Path: ${error.requestOptions.path}');
          
          if (error.type == DioExceptionType.connectionError) {
            debugPrint('Connection Error - Backend may not be running at ${error.requestOptions.baseUrl}');
          }
          
          if (error.response != null) {
            debugPrint('Status: ${error.response!.statusCode}');
          }
        }
        
        if (error.response?.statusCode == 401) {
          // Try to refresh token if we have a refresh token
          try {
            final refreshToken = await _readSecure('refresh_token');
            if (refreshToken != null && refreshToken.isNotEmpty) {
              if (kDebugMode) {
                debugPrint('Attempting to refresh token...');
              }
              // Create a new dio instance without interceptors to avoid recursion
              final refreshDio = Dio(_dio.options);
              final refreshResponse = await refreshDio.post(
                '${_dio.options.baseUrl}/auth/refresh',
                data: {'refreshToken': refreshToken},
              );
              
              if (refreshResponse.statusCode == 200) {
                // Backend returns 'accessToken' not 'token'
                final newToken = refreshResponse.data['accessToken'] as String? ?? refreshResponse.data['token'] as String?;
                if (newToken != null) {
                  await setToken(newToken);
                  // Also save refresh token if provided
                  final newRefreshToken = refreshResponse.data['refreshToken'] as String?;
                  if (newRefreshToken != null) {
                    await _writeSecure('refresh_token', newRefreshToken);
                  }
                  if (kDebugMode) {
                    debugPrint('Token refreshed successfully');
                  }
                  
                  // Retry the original request with new token
                  final opts = error.requestOptions;
                  opts.headers['Authorization'] = 'Bearer $newToken';
                  final cloneReq = await _dio.request(
                    opts.path,
                    options: Options(
                      method: opts.method,
                      headers: opts.headers,
                    ),
                    data: opts.data,
                    queryParameters: opts.queryParameters,
                  );
                  return handler.resolve(Response(
                    requestOptions: opts,
                    data: cloneReq.data,
                    statusCode: cloneReq.statusCode,
                    statusMessage: cloneReq.statusMessage,
                  ));
                }
              }
            }
          } catch (refreshError) {
            if (kDebugMode) {
              debugPrint('Token refresh failed: $refreshError');
            }
          }
          
          // If refresh failed or no refresh token, clear and require re-login
          if (kDebugMode) {
            debugPrint('Token expired. Please log in again.');
          }
          await clearToken();
          await _deleteSecure('refresh_token');
        }
        return handler.next(error);
      },
    ));

    // Load token asynchronously but don't block constructor
    _loadToken();
  }

  Future<void> _loadToken() async {
    try {
      _accessToken = await _readSecure('access_token');
      if (_accessToken != null && _accessToken!.isNotEmpty) {
        _dio.options.headers['Authorization'] = 'Bearer $_accessToken';
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error loading token: $e');
      }
    }
  }

  Future<void> setToken(String token) async {
    _accessToken = token;
    await _writeSecure('access_token', token);
    // Update Dio headers immediately
    _dio.options.headers['Authorization'] = 'Bearer $_accessToken';
  }

  Future<void> clearToken() async {
    _accessToken = null;
    await _deleteSecure('access_token');
    _dio.options.headers.remove('Authorization');
  }

  /// Check if a token exists (in memory or storage)
  /// 
  /// Returns true if a valid token is found and loaded into memory.
  /// If token exists in storage but not in memory, it will be loaded.
  Future<bool> hasToken() async {
    // Already loaded and set?
    if (_accessToken != null && _accessToken!.isNotEmpty) {
      return true;
    }

    // Try to read from storage
    final stored = await _readSecure('access_token');
    if (stored != null && stored.isNotEmpty) {
      _accessToken = stored;
      _dio.options.headers['Authorization'] = 'Bearer $_accessToken';
      return true;
    }

    return false;
  }

  /// Read from secure storage (with web fallback)
  Future<String?> _readSecure(String key) async {
    if (kIsWeb) {
      // Use SharedPreferences for web
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString('secure_$key');
    } else {
      return await _secureStorage?.read(key: key);
    }
  }

  /// Write to secure storage (with web fallback)
  Future<void> _writeSecure(String key, String value) async {
    if (kIsWeb) {
      // Use SharedPreferences for web
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('secure_$key', value);
    } else {
      await _secureStorage?.write(key: key, value: value);
    }
  }

  /// Delete from secure storage (with web fallback)
  Future<void> _deleteSecure(String key) async {
    if (kIsWeb) {
      // Use SharedPreferences for web
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('secure_$key');
    } else {
      await _secureStorage?.delete(key: key);
    }
  }

  Future<Response> get(String path, {Map<String, dynamic>? queryParameters}) async {
    return await _dio.get(path, queryParameters: queryParameters);
  }

  Future<Response> post(String path, {dynamic data}) async {
    return await _dio.post(path, data: data);
  }

  Future<Response> patch(String path, {dynamic data}) async {
    return await _dio.patch(path, data: data);
  }

  Future<Response> delete(String path) async {
    return await _dio.delete(path);
  }

  Future<Response> postMultipart(String path, FormData formData) async {
    return await _dio.post(path, data: formData);
  }

  void setBaseUrl(String url) {
    _validateBaseUrl(url);
    _baseUrl = url;
    _dio.options.baseUrl = url;
  }

  /// Get default base URL based on runtime environment
  /// 
  /// Detects the runtime environment (web vs mobile, debug vs release) and returns
  /// appropriate default URLs for development.
  /// 
  /// Platform-specific defaults:
  /// - Web: http://localhost:3000/api/v1
  /// - iOS Simulator: http://localhost:3000/api/v1 (can use localhost)
  /// - Android Emulator: http://10.0.2.2:3000/api/v1 (needs special address)
  /// - Physical Device: Use --dart-define=API_BASE_URL=http://<your-laptop-ip>:3000/api/v1
  /// 
  /// For production builds, use --dart-define to override:
  /// - Development: `flutter run` (uses localhost defaults)
  /// - Staging: `flutter build web --dart-define=API_BASE_URL=https://staging-api.example.com/api/v1`
  /// - Production: `flutter build web --dart-define=API_BASE_URL=https://api.example.com/api/v1`
  /// - Android: `flutter build apk --release --dart-define=API_BASE_URL=https://api.example.com/api/v1`
  /// - iOS: `flutter build ios --release --dart-define=API_BASE_URL=https://api.example.com/api/v1`
  static String _getDefaultBaseUrl() {
    if (kIsWeb) {
      // Web platform - use localhost for development
      return 'http://localhost:3000/api/v1';
    } else {
      // Mobile platform - detect iOS vs Android
      try {
        // iOS simulator - try localhost first, but can also use machine IP
        if (defaultTargetPlatform == TargetPlatform.iOS) {
          // iOS simulator can use localhost, but if that fails, use 127.0.0.1
          // For physical devices, use --dart-define=API_BASE_URL=http://<your-ip>:3000/api/v1
          return 'http://127.0.0.1:3000/api/v1';
        }
        // Android emulator needs 10.0.2.2
        // Physical devices should use --dart-define with actual IP
        return 'http://10.0.2.2:3000/api/v1';
      } catch (e) {
        // Fallback to Android address if platform detection fails
        return 'http://10.0.2.2:3000/api/v1';
      }
    }
  }

  /// Validate base URL format and log warnings for common misconfigurations
  /// 
  /// Validates that the URL:
  /// - Starts with http:// or https://
  /// - Ends with /api/v1
  /// 
  /// Logs warnings for:
  /// - Missing protocol
  /// - Missing /api/v1 suffix
  /// - Using http:// in production (should use https://)
  static void _validateBaseUrl(String url) {
    if (kDebugMode) {
      // Check for protocol
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        debugPrint('Warning: API_BASE_URL should start with http:// or https://');
      }

      // Check for /api/v1 suffix
      if (!url.endsWith('/api/v1')) {
        debugPrint('Warning: API_BASE_URL should end with /api/v1');
      }

      // Warn about http in production-like URLs (contains domain, not localhost)
      if (url.startsWith('http://') && 
          !url.contains('localhost') && 
          !url.contains('127.0.0.1') && 
          !url.contains('10.0.2.2')) {
        debugPrint('Warning: Using http:// for non-localhost URL. Consider using https:// for production');
      }
    }
  }
}

