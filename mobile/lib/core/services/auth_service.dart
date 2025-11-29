import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb, kDebugMode, debugPrint;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../models/user.dart';
import 'api_client.dart';

class AuthService {
  final ApiClient _apiClient;
  final FlutterSecureStorage? _secureStorage;
  User? _currentUser;

  AuthService(this._apiClient, this._secureStorage);

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

        await _saveTokens(token, refreshToken);
        await _saveUserData(userData);
        _currentUser = User.fromJson(userData);
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

      await _saveTokens(token, refreshToken);
      await _saveUserData(userData);

      _currentUser = User.fromJson(userData);
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

  /// Refresh access token
  Future<void> refreshToken() async {
    try {
      final refreshToken = await _readSecure('refresh_token');
      if (refreshToken == null) {
        throw Exception('No refresh token available');
      }

      final response = await _apiClient.post('/auth/refresh', data: {
        'refreshToken': refreshToken,
      });

      final token = response.data['token'] as String;
      await _writeSecure('access_token', token);
      await _apiClient.setToken(token);
    } catch (e) {
      await logout();
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

  /// Logout user
  Future<void> logout() async {
    _currentUser = null;
    await _deleteSecure('access_token');
    await _deleteSecure('refresh_token');
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('user_id');
    await prefs.remove('user_data');
    await _apiClient.clearToken();
  }

  /// Check if user is logged in by validating the token with the backend
  /// This is more reliable than just checking if a token exists
  Future<bool> isLoggedIn() async {
    try {
      // First check if we have a token
      final hasToken = await _apiClient.hasToken();
      if (!hasToken) {
        return false;
      }

      // Validate token by making a lightweight API call
      // This ensures the token is still valid and not expired
      try {
        // Try to fetch clients (lightweight call that requires auth)
        await _apiClient.get('/clients', queryParameters: {'limit': 1});
        
        // Token is valid, load user data
        await _loadUserData();
        
        final isLoggedIn = _currentUser != null;
        return isLoggedIn;
      } on DioException catch (e) {
        // 401 means token expired/invalid
        if (e.response?.statusCode == 401) {
          await logout();
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

