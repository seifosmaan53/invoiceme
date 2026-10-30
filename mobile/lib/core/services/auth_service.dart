import 'dart:convert';
import 'dart:io' show Directory, File;
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb, kDebugMode, debugPrint;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../models/user.dart';
import '../database/local_accounts.dart';
import 'api_client.dart';

/// Preferences holding the signed-in account's data (removed on sign-out).
const List<String> accountPreferenceKeys = ['user_id', 'user_data', 'dashboard_stats_cache'];

class AuthService {
  final ApiClient _apiClient;
  final FlutterSecureStorage? _secureStorage;
  final LocalAccounts? _accounts;
  User? _currentUser;

  // Sign-in, sign-out and the start-up session check run one at a time.
  Future<void> _transitions = Future.value();

  Future<T> _serialized<T>(Future<T> Function() action) {
    final result = _transitions.then((_) => action());
    _transitions = result.then((_) {}, onError: (_) {});
    return result;
  }

  /// [accounts]: per-account local storage (default: the app's; none on web).
  AuthService(this._apiClient, this._secureStorage, {LocalAccounts? accounts})
      : _accounts = accounts ?? (kIsWeb ? null : LocalAccounts.instance) {
    _apiClient.onSessionExpired = () {
      logout().catchError((Object e) {
        if (kDebugMode) debugPrint('Sign-out after session expiry failed: $e');
      });
    };
  }

  User? get currentUser => _currentUser;

  /// Register a new user
  /// [autoLogin] - If true, saves tokens and logs user in. If false, just registers without logging in.
  Future<User> register({
    required String email,
    required String password,
    required String name,
    String? companyName,
    bool autoLogin = false,
  }) async {
    // Build request data - only include companyName if it has a value
    final requestData = <String, dynamic>{
      'email': email.trim(),
      'password': password,
      'name': name.trim(),
    };
    
    // Only add companyName if it's not null and not empty
    final companyNameValue = companyName?.trim();
    if (companyNameValue != null && companyNameValue.isNotEmpty) {
      requestData['companyName'] = companyNameValue;
    }
    
    
    try {
      final response = await _apiClient.post('/auth/register', data: requestData);
      

      final userData = response.data['user'] as Map<String, dynamic>;
      
      // Only save tokens and user data if autoLogin is true
      if (autoLogin) {
        // Backend returns 'accessToken' and 'refreshToken', not 'token'
        final token = response.data['accessToken'] as String? ?? response.data['token'] as String;
        final refreshToken = response.data['refreshToken'] as String;

        if (token == null || refreshToken == null) {
          throw Exception('Registration succeeded but tokens are missing');
        }

        await _serialized(() => _startSession(token, refreshToken, userData));
      } else {
        // Just create the user object without saving tokens
        _currentUser = User.fromJson(userData);
      }

      return _currentUser!;
    } on DioException catch (e) {
      // Log detailed error for debugging
      if (kDebugMode) {
        debugPrint('Registration error: ${e.response?.statusCode} - ${e.message}');
      }
      
      // Distinguish between actual network errors and backend errors
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.unknown ||
          e.response == null) {
        // True network error - browser couldn't reach the server
        throw Exception('Network error: Unable to connect to server. Please check that the backend is running at http://localhost:3000');
      }
      
      // Backend responded with an error - extract the actual message
      if (e.response != null) {
        final statusCode = e.response!.statusCode ?? 500;
        final errorData = e.response!.data;
        
        // Extract backend error message
        String backendMessage = 'Registration failed';
        if (errorData is Map<String, dynamic>) {
          if (errorData['message'] != null) {
            final msg = errorData['message'];
            backendMessage = msg is List ? msg.join(', ') : msg.toString();
          } else if (errorData['error'] != null) {
            backendMessage = errorData['error'].toString();
          }
        } else if (errorData is String) {
          backendMessage = errorData;
        }
        
        // Provide specific error messages based on status code
        if (statusCode == 400) {
          throw Exception('Registration failed: $backendMessage');
        } else if (statusCode == 409) {
          throw Exception('This email is already registered. Please login instead.');
        } else if (statusCode == 429) {
          throw Exception('Too many registration attempts. Please wait a moment and try again.');
        } else if (statusCode >= 500) {
          throw Exception('Server error ($statusCode): $backendMessage');
        } else {
          throw Exception('Registration failed ($statusCode): $backendMessage');
        }
      }
      
      rethrow;
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Unexpected registration error: $e');
      }
      rethrow;
    }
  }

  /// Login with email and password
  Future<User> login(String email, String password) async {
    
    try {
      final response = await _apiClient.post('/auth/login', data: {
        'email': email.trim(),
        'password': password,
      });


      final userData = response.data['user'] as Map<String, dynamic>;
      // Backend returns 'accessToken' and 'refreshToken', not 'token'
      final token = response.data['accessToken'] as String? ?? response.data['token'] as String;
      final refreshToken = response.data['refreshToken'] as String;

      if (token == null || refreshToken == null) {
        throw Exception('Login succeeded but tokens are missing');
      }

      await _serialized(() => _startSession(token, refreshToken, userData));
      return _currentUser!;
    } on DioException catch (e) {
      // Log detailed error for debugging
      if (kDebugMode) {
        debugPrint('Login error: ${e.response?.statusCode} - ${e.message}');
      }
      
      // Distinguish between actual network errors and backend errors
      if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.unknown ||
          e.response == null) {
        // True network error - browser couldn't reach the server
        throw Exception('Network error: Unable to connect to server. Please check that the backend is running at http://localhost:3000');
      }
      
      // Backend responded with an error - extract the actual message
      if (e.response != null) {
        final statusCode = e.response!.statusCode ?? 500;
        final errorData = e.response!.data;
        
        // Extract backend error message
        String backendMessage = 'Login failed';
        if (errorData is Map<String, dynamic>) {
          if (errorData['message'] != null) {
            final msg = errorData['message'];
            backendMessage = msg is List ? msg.join(', ') : msg.toString();
          } else if (errorData['error'] != null) {
            backendMessage = errorData['error'].toString();
          }
        } else if (errorData is String) {
          backendMessage = errorData;
        }
        
        // Provide specific error messages based on status code
        if (statusCode == 400) {
          throw Exception('Login failed: $backendMessage');
        } else if (statusCode == 401) {
          throw Exception('Invalid email or password. Please try again.');
        } else if (statusCode == 429) {
          throw Exception('Too many login attempts. Please wait a moment and try again.');
        } else if (statusCode >= 500) {
          throw Exception('Server error ($statusCode): $backendMessage');
        } else {
          throw Exception('Login failed ($statusCode): $backendMessage');
        }
      }
      
      rethrow;
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Unexpected login error: $e');
      }
      rethrow;
    }
  }

  /// Change password
  Future<void> changePassword(String currentPassword, String newPassword) async {
    try {
      await _apiClient.post('/auth/change-password', data: {
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      });
    } on DioException catch (e) {
      if (e.response?.statusCode == 401) {
        throw Exception('Current password is incorrect. Please try again.');
      } else if (e.response?.statusCode == 400) {
        final errorData = e.response?.data;
        String message = 'Failed to change password. Please check your input.';
        if (errorData is Map && errorData['message'] != null) {
          final msg = errorData['message'];
          message = msg is List ? msg.join(', ') : msg.toString();
        }
        throw Exception(message);
      } else if (e.type == DioExceptionType.connectionError ||
          e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.unknown ||
          e.response == null) {
        throw Exception('Network error: Unable to connect to server. Please check that the backend is running at http://localhost:3000');
      } else if (e.response != null) {
        final statusCode = e.response!.statusCode ?? 500;
        final errorData = e.response!.data;
        String backendMessage = 'Failed to change password';
        if (errorData is Map<String, dynamic>) {
          if (errorData['message'] != null) {
            final msg = errorData['message'];
            backendMessage = msg is List ? msg.join(', ') : msg.toString();
          } else if (errorData['error'] != null) {
            backendMessage = errorData['error'].toString();
          }
        }
        throw Exception('Change password failed ($statusCode): $backendMessage');
      }
      rethrow;
    }
  }

  /// Makes the account of a successful login the signed-in one. The
  /// previous account's session ends first (its requests are cancelled, its
  /// sync stopped and its database closed); the token must belong to the
  /// account the server returned; the account's own database is opened last.
  Future<void> _startSession(String token, String refreshToken, Map<String, dynamic> userData) async {
    final userId = userData['id'];
    if (userId is! String || userId.isEmpty) {
      throw Exception('Login response without an account id');
    }
    final subject = ApiClient.tokenSubject(token);
    if (subject != null && subject != userId) {
      throw Exception('Login response token belongs to another account');
    }
    await _endSession();
    await _saveTokens(token, refreshToken);
    await _writeSecure('token_user_id', userId);
    await _saveUserData(userData);
    _apiClient.bindSession(userId);
    try {
      await _accounts?.activate(userId);
    } catch (e) {
      await _endSession();
      rethrow;
    }
    _currentUser = User.fromJson(userData);
  }

  /// Ends the session: stops and hides the signed-in account's local data
  /// (kept on the device for that account), then removes its credentials.
  Future<void> _endSession() async {
    // Before any await: the running sync must not send or write again.
    _accounts?.invalidate();
    _currentUser = null;
    await _apiClient.endSession();
    await _accounts?.deactivate();
    await _deleteSecure('access_token');
    await _deleteSecure('refresh_token');
    await _deleteSecure('token_user_id');
    final prefs = await SharedPreferences.getInstance();
    for (final key in accountPreferenceKeys) {
      await prefs.remove(key);
    }
    await _deleteSharedFiles();
  }

  /// Invoice PDFs written to the shared temporary directory for viewing or
  /// sharing (downloaded again when needed).
  static Future<void> _deleteSharedFiles() async {
    if (kIsWeb) return;
    try {
      final dir = Directory((await getTemporaryDirectory()).path);
      if (!await dir.exists()) return;
      await for (final entry in dir.list()) {
        final name = entry.uri.pathSegments.isEmpty ? '' : entry.uri.pathSegments.last;
        if (entry is File && RegExp(r'^[Ii]nvoice_.*\.pdf$').hasMatch(name)) {
          await entry.delete();
        }
      }
    } catch (e) {
      if (kDebugMode) debugPrint('Could not remove temporary invoice files: $e');
    }
  }

  /// Logout user. The account's local data (including changes not synced
  /// yet) stays on the device for this account and is hidden until it signs in again.
  Future<void> logout() => _serialized(_endSession);

  /// Unsynced changes of the signed-in account on this device.
  Future<int> unsyncedLocalChanges() async => await _accounts?.unsyncedCount() ?? 0;

  /// Signs out and permanently removes this account's data from the device.
  /// With unsynced changes this needs [confirmUnsyncedLoss] (the person was
  /// warned); otherwise [UnsyncedChangesException] is thrown and nothing is
  /// removed (the account stays signed out, its data kept).
  Future<void> logoutAndRemoveLocalData({required bool confirmUnsyncedLoss}) => _serialized(() async {
        final userId = _accounts?.activeUserId ?? _currentUser?.id;
        await _endSession();
        if (userId != null) {
          await _accounts?.removeAccountData(userId, confirmUnsyncedLoss: confirmUnsyncedLoss);
        }
      });

  /// Check if user is logged in by validating the token with the backend
  /// This is more reliable than just checking if a token exists
  Future<bool> isLoggedIn() => _serialized(_checkSession);

  Future<bool> _checkSession() async {
    try {
      // First check if we have a token
      final hasToken = await _apiClient.hasToken();
      if (!hasToken) {
        return false;
      }

      // The stored token and the stored account must be the same account
      // (they are written separately; an interrupted sign-in could leave
      // one account's token with another's details, or no details).
      await _loadUserData();
      final user = _currentUser;
      final token = await _readSecure('access_token');
      final tokenUser = await _readSecure('token_user_id');
      final subject = ApiClient.tokenSubject(token);
      if (user == null || subject != user.id || (tokenUser != null && tokenUser != user.id)) {
        if (kDebugMode) debugPrint('Stored token does not match the stored account; signing out');
        await _endSession();
        return false;
      }
      // Bound before the first request, so a refresh can only accept this account.
      if (_apiClient.sessionUserId != user.id) _apiClient.bindSession(user.id);

      // Validate token by making a lightweight API call
      // This ensures the token is still valid and not expired
      try {
        // Try to fetch clients (lightweight call that requires auth)
        await _apiClient.get('/clients', queryParameters: {'limit': 1});
        try {
          await _accounts?.activate(user.id);
        } catch (e) {
          if (kDebugMode) debugPrint('Could not open the account\'s local data: $e');
          await _endSession();
          return false;
        }
        return true;
      } on DioException catch (e) {
        // 401 means token expired/invalid
        if (e.response?.statusCode == 401) {
          await _endSession();
          return false;
        }
        // Network errors - don't clear token, just return false
        // User might be offline, token could still be valid
        if (kDebugMode) {
          debugPrint('Network error during login check: ${e.message}');
        }
        return false;
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error checking login status: $e');
      }
      return false;
    }
  }

  /// Load user data from storage and restore token in API client
  Future<void> _loadUserData() async {
    try {
      // Load user data from SharedPreferences
      final prefs = await SharedPreferences.getInstance();
      final userDataJson = prefs.getString('user_data');
      if (userDataJson != null && userDataJson.isNotEmpty) {
        final userData = jsonDecode(userDataJson) as Map<String, dynamic>;
        _currentUser = User.fromJson(userData);
      }

      // Restore token in API client (hasToken() will load it if not already in memory)
      final hasToken = await _apiClient.hasToken();
      if (hasToken) {
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error loading user data: $e');
      }
      // Clear corrupted data
      _currentUser = null;
      await _deleteSecure('access_token');
      await _deleteSecure('refresh_token');
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('user_data');
    }
  }

  /// Save tokens securely
  Future<void> _saveTokens(String token, String refreshToken) async {
    await _writeSecure('access_token', token);
    await _writeSecure('refresh_token', refreshToken);
    await _apiClient.setToken(token);
  }

  /// Save user data
  Future<void> _saveUserData(Map<String, dynamic> userData) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('user_id', userData['id']);
    await prefs.setString('user_data', jsonEncode(userData));
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

  /// Update user profile (name and company name)
  Future<User> updateProfile({
    String? name,
    String? companyName,
  }) async {
    final requestData = <String, dynamic>{};
    if (name != null) {
      requestData['name'] = name.trim();
    }
    if (companyName != null) {
      requestData['companyName'] = companyName.trim().isEmpty ? null : companyName.trim();
    }

    if (requestData.isEmpty) {
      throw Exception('At least one field must be provided');
    }

    try {
      final response = await _apiClient.patch('/auth/profile', data: requestData);
      final userData = response.data as Map<String, dynamic>;
      
      // Update current user
      _currentUser = User.fromJson(userData);
      
      // Save updated user data
      await _saveUserData(userData);
      
      return _currentUser!;
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error updating profile: $e');
      }
      rethrow;
    }
  }

  /// Initialize auth service (load saved user)
  Future<void> initialize() async {
    await _loadUserData();
  }
}

