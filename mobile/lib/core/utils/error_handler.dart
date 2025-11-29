import 'package:dio/dio.dart';

/// Error codes from backend
enum ErrorCode {
  validationError,
  authenticationError,
  authorizationError,
  notFoundError,
  conflictError,
  rateLimitError,
  internalServerError,
  networkError,
  unknown,
}

/// Field-level validation error
class ValidationError {
  final String field;
  final List<String> messages;
  final dynamic value;

  ValidationError({
    required this.field,
    required this.messages,
    this.value,
  });

  factory ValidationError.fromJson(Map<String, dynamic> json) {
    return ValidationError(
      field: json['field'] as String? ?? 'unknown',
      messages: (json['messages'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          [],
      value: json['value'],
    );
  }

  String get message => messages.join(', ');
}

/// Structured error response from backend
class ApiError {
  final int statusCode;
  final List<String> messages;
  final ErrorCode errorCode;
  final List<ValidationError>? fieldErrors;
  final String? path;
  final String timestamp;

  ApiError({
    required this.statusCode,
    required this.messages,
    required this.errorCode,
    this.fieldErrors,
    this.path,
    required this.timestamp,
  });

  /// Get user-friendly error message
  String get userMessage {
    if (fieldErrors != null && fieldErrors!.isNotEmpty) {
      // Return first field error message
      return fieldErrors!.first.message;
    }
    return messages.isNotEmpty ? messages.first : 'An error occurred';
  }

  /// Get all error messages combined
  String get allMessages => messages.join('\n');

  /// Check if error has field-level validation errors
  bool get hasFieldErrors => fieldErrors != null && fieldErrors!.isNotEmpty;

  /// Get error message for a specific field
  String? getFieldError(String fieldName) {
    if (fieldErrors == null) return null;
    final fieldError = fieldErrors!.firstWhere(
      (e) => e.field.toLowerCase() == fieldName.toLowerCase(),
      orElse: () => ValidationError(field: '', messages: []),
    );
    return fieldError.messages.isNotEmpty ? fieldError.message : null;
  }

  /// Parse error from DioException
  factory ApiError.fromDioException(DioException error) {
    // True network errors - browser couldn't reach the server at all
    if (error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.connectionTimeout ||
        (error.type == DioExceptionType.unknown && error.response == null)) {
      return ApiError(
        statusCode: 0,
        messages: [
          'Network error: Unable to connect to server. Please check that the backend is running at http://localhost:3000',
        ],
        errorCode: ErrorCode.networkError,
        timestamp: DateTime.now().toIso8601String(),
      );
    }
    
    // If response is null but it's not a connection error, still treat as network error
    if (error.response == null) {
      return ApiError(
        statusCode: 0,
        messages: [
          'Network error: Unable to connect to server. Please check your internet connection.',
        ],
        errorCode: ErrorCode.networkError,
        timestamp: DateTime.now().toIso8601String(),
      );
    }

    final response = error.response!;
    final statusCode = response.statusCode ?? 500;
    final data = response.data;

    // Parse structured error response
    if (data is Map<String, dynamic>) {
      final errorCodeStr = data['errorCode'] as String?;
      final errorCode = _parseErrorCode(errorCodeStr, statusCode);

      // Parse messages
      List<String> messages = [];
      if (data['message'] != null) {
        final message = data['message'];
        if (message is List) {
          messages = message.map((e) => e.toString()).toList();
        } else {
          messages = [message.toString()];
        }
      }

      // Parse field-level validation errors
      List<ValidationError>? fieldErrors;
      if (data['errors'] != null && data['errors'] is List) {
        fieldErrors = (data['errors'] as List)
            .map((e) => ValidationError.fromJson(e as Map<String, dynamic>))
            .toList();
      }

      return ApiError(
        statusCode: statusCode,
        messages: messages.isNotEmpty
            ? messages
            : ['An error occurred'],
        errorCode: errorCode,
        fieldErrors: fieldErrors,
        path: data['path'] as String?,
        timestamp: data['timestamp'] as String? ?? DateTime.now().toIso8601String(),
      );
    }

    // Fallback for non-structured errors
    String message = 'An error occurred';
    if (data is String) {
      message = data;
    } else if (data is Map && data['message'] != null) {
      final msg = data['message'];
      message = msg is List ? msg.join(', ') : msg.toString();
    }

    return ApiError(
      statusCode: statusCode,
      messages: [message],
      errorCode: _parseErrorCode(null, statusCode),
      timestamp: DateTime.now().toIso8601String(),
    );
  }

  /// Parse error code from string or status code
  static ErrorCode _parseErrorCode(String? errorCodeStr, int statusCode) {
    if (errorCodeStr != null) {
      switch (errorCodeStr.toUpperCase()) {
        case 'VALIDATION_ERROR':
          return ErrorCode.validationError;
        case 'AUTHENTICATION_ERROR':
          return ErrorCode.authenticationError;
        case 'AUTHORIZATION_ERROR':
          return ErrorCode.authorizationError;
        case 'NOT_FOUND_ERROR':
          return ErrorCode.notFoundError;
        case 'CONFLICT_ERROR':
          return ErrorCode.conflictError;
        case 'RATE_LIMIT_ERROR':
          return ErrorCode.rateLimitError;
        case 'INTERNAL_SERVER_ERROR':
          return ErrorCode.internalServerError;
        case 'NETWORK_ERROR':
          return ErrorCode.networkError;
      }
    }

    // Fallback to status code
    if (statusCode >= 500) {
      return ErrorCode.internalServerError;
    } else if (statusCode == 401) {
      return ErrorCode.authenticationError;
    } else if (statusCode == 403) {
      return ErrorCode.authorizationError;
    } else if (statusCode == 404) {
      return ErrorCode.notFoundError;
    } else if (statusCode == 409) {
      return ErrorCode.conflictError;
    } else if (statusCode == 429) {
      return ErrorCode.rateLimitError;
    } else if (statusCode == 400) {
      return ErrorCode.validationError;
    }

    return ErrorCode.unknown;
  }

  /// Get user-friendly error message based on error code
  String getFriendlyMessage() {
    switch (errorCode) {
      case ErrorCode.validationError:
        if (hasFieldErrors) {
          return userMessage;
        }
        return 'Please check your input and try again.';
      case ErrorCode.authenticationError:
        return 'Your session has expired. Please log in again.';
      case ErrorCode.authorizationError:
        return 'You do not have permission to perform this action.';
      case ErrorCode.notFoundError:
        return 'The requested resource was not found.';
      case ErrorCode.conflictError:
        return 'This action conflicts with existing data.';
      case ErrorCode.rateLimitError:
        return 'Too many requests. Please wait a moment and try again.';
      case ErrorCode.networkError:
        return 'Network error. Please check your internet connection.';
      case ErrorCode.internalServerError:
        return 'A server error occurred. Please try again later.';
      case ErrorCode.unknown:
        return userMessage;
    }
  }
}

/// Extension to easily convert DioException to ApiError
extension DioExceptionExtension on DioException {
  ApiError toApiError() => ApiError.fromDioException(this);
}

