import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Error boundary widget that catches errors and shows retry UI
class ErrorBoundary extends ConsumerStatefulWidget {
  final Widget child;
  final String? errorMessage;
  final VoidCallback? onRetry;

  const ErrorBoundary({
    super.key,
    required this.child,
    this.errorMessage,
    this.onRetry,
  });

  @override
  ConsumerState<ErrorBoundary> createState() => _ErrorBoundaryState();
}

class _ErrorBoundaryState extends ConsumerState<ErrorBoundary> {
  bool hasError = false;
  String? errorMessage;
  void Function(FlutterErrorDetails)? _originalErrorHandler;
  int _retryCount = 0;
  static const int _maxRetries = 3;

  @override
  void initState() {
    super.initState();
    // Store original error handler
    _originalErrorHandler = FlutterError.onError;
    
    // Catch Flutter errors - use post-frame callback to ensure widget is mounted
    FlutterError.onError = (FlutterErrorDetails details) {
      // Call original handler first for logging
      _originalErrorHandler?.call(details);
      
      // Only show error UI for real errors, not harmless web warnings
      // Skip "No Directionality widget found" and similar web-specific warnings
      final exceptionStr = details.exception.toString();
      final stackTraceStr = details.stack?.toString() ?? '';
      if (exceptionStr.contains('No Directionality widget found') ||
          exceptionStr.contains('LegacyJavaScriptObject') ||
          exceptionStr.contains('DiagnosticsNode') ||
          (exceptionStr.contains('Unexpected null value') && 
           stackTraceStr.contains('focus_traversal'))) {
        // These are harmless Flutter web warnings, don't show error UI
        return;
      }
      
      if (mounted) {
        // Schedule setState for next frame to avoid build context issues
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            setState(() {
              hasError = true;
              errorMessage = details.exception.toString();
            });
          }
        });
      }
    };
  }

  @override
  void dispose() {
    // Restore original error handler
    if (_originalErrorHandler != null) {
      FlutterError.onError = _originalErrorHandler;
    }
    super.dispose();
  }

  void _handleRetry() {
    if (_retryCount >= _maxRetries) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Maximum retry attempts reached. Please refresh the page.'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() {
      hasError = false;
      errorMessage = null;
      _retryCount++;
    });
    
    // Call onRetry callback if provided
    widget.onRetry?.call();
    
    // If no callback, try to rebuild the widget
    if (widget.onRetry == null) {
      // Force a rebuild by calling setState again after a delay
      Future.delayed(const Duration(milliseconds: 100), () {
        if (mounted) {
          setState(() {});
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (hasError || widget.errorMessage != null) {
      // Error widget is now inside MaterialApp, so it has Directionality
      return Scaffold(
        body: _ErrorWidget(
          message: widget.errorMessage ?? errorMessage ?? 'An error occurred',
          onRetry: _retryCount < _maxRetries ? _handleRetry : null,
          retryCount: _retryCount,
          maxRetries: _maxRetries,
        ),
      );
    }

    return widget.child;
  }
}

class _ErrorWidget extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final int retryCount;
  final int maxRetries;

  const _ErrorWidget({
    required this.message,
    this.onRetry,
    this.retryCount = 0,
    this.maxRetries = 3,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Center(
        child: SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.error_outline,
                  size: 64,
                  color: Colors.red[300],
                ),
                const SizedBox(height: 16),
                Text(
                  'Something went wrong',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey[600]),
                ),
                if (onRetry != null) ...[
                  const SizedBox(height: 24),
                  ElevatedButton.icon(
                    onPressed: onRetry,
                    icon: const Icon(Icons.refresh),
                    label: Text('Retry (${retryCount + 1}/$maxRetries)'),
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                    ),
                  ),
                ] else if (retryCount >= maxRetries) ...[
                  const SizedBox(height: 24),
                  Text(
                    'Maximum retries reached. Please refresh the page.',
                    style: TextStyle(color: Colors.grey[600], fontSize: 12),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Error banner for showing API errors
class ErrorBanner extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  final VoidCallback? onDismiss;

  const ErrorBanner({
    super.key,
    required this.message,
    this.onRetry,
    this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      color: Colors.red[50],
      child: Row(
        children: [
          Icon(Icons.error_outline, color: Colors.red[700]),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: Colors.red[900],
                fontSize: 14,
              ),
            ),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          if (onDismiss != null)
            IconButton(
              icon: const Icon(Icons.close, size: 20),
              onPressed: onDismiss,
              color: Colors.red[700],
            ),
        ],
      ),
    );
  }
}

