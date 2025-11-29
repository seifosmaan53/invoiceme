// Flutter imports
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter/material.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Local imports - Core
import '../core/providers/providers.dart';
import '../core/utils/error_handler.dart';
import '../core/widgets/copyable_error.dart';

// Local imports - Screens
import 'dashboard_screen.dart';

// Local imports - Widgets
import '../widgets/mobile_view_wrapper.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;
  bool _isRegisterMode = false;
  bool _obscurePassword = true;
  final _nameController = TextEditingController();
  final _companyNameController = TextEditingController();
  Map<String, String?> _fieldErrors = {}; // Field-level validation errors
  
  // Email validation regex
  static final _emailRegex = RegExp(r'^[^@]+@[^@]+\.[^@]+$');

  @override
  void initState() {
    super.initState();
    // Use addPostFrameCallback to avoid build warnings
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
    _checkLoggedIn();
      }
    });
  }

  /// Check if user is already logged in and redirect to dashboard
  Future<void> _checkLoggedIn() async {
    try {
      final authService = ref.read(authServiceProvider);
      final loggedIn = await authService.isLoggedIn();
      
      if (!mounted) return;
      
      if (loggedIn) {
        // User is already logged in, skip login screen
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const DashboardScreen()),
        );
      }
    } catch (e) {
      // If check fails, just show login screen (user needs to log in)
      debugPrint('Error checking login status: $e');
    }
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nameController.dispose();
    _companyNameController.dispose();
    super.dispose();
  }

  /// Show dialog when user tries to register with an already registered email
  void _showAlreadyRegisteredDialog(String email) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Row(
          children: [
            const Icon(Icons.info_outline, color: Colors.blue),
            const SizedBox(width: 8),
            const Expanded(child: Text('Already Registered')),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'This email is already registered.',
              style: TextStyle(fontSize: 16),
            ),
            const SizedBox(height: 8),
            SelectableText(
              email,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: Colors.blue[700],
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Would you like to continue to the login screen?',
              style: TextStyle(fontSize: 14),
            ),
          ],
        ),
        actions: [
          // Go Back button
          TextButton(
            onPressed: () {
              Navigator.of(context).pop();
            },
            child: const Text('Go Back'),
          ),
          // Continue to Login button
          ElevatedButton(
            onPressed: () {
              Navigator.of(context).pop(); // Close dialog
              
              // Save the email before clearing
              final savedEmail = _emailController.text.trim();
              
              // Clear all fields
              _emailController.clear();
              _passwordController.clear();
              _nameController.clear();
              _companyNameController.clear();
              
              // Reset form validation
              _formKey.currentState?.reset();
              
              // Switch to login mode
              setState(() {
                _isRegisterMode = false;
                _obscurePassword = true;
              });
              
              // Restore the email after state update
              Future.delayed(const Duration(milliseconds: 100), () {
                if (mounted) {
                  _emailController.text = savedEmail;
                }
              });
              
              // Show a helpful message
              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Row(
                      children: [
                        const Icon(Icons.info_outline, color: Colors.white),
                        const SizedBox(width: 8),
                        Expanded(
                          child: SelectableText(
                            'Please enter your password to sign in.',
                            style: const TextStyle(color: Colors.white),
                            enableInteractiveSelection: true,
                          ),
                        ),
                      ],
                    ),
                    backgroundColor: Colors.blue,
                    duration: const Duration(seconds: 3),
                  ),
                );
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.blue,
              foregroundColor: Colors.white,
            ),
            child: const Text('Continue to Login'),
          ),
        ],
      ),
    );
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;

    // Hide keyboard
    FocusScope.of(context).unfocus();

    setState(() => _isLoading = true);

    try {
      final authService = ref.read(authServiceProvider);

      if (_isRegisterMode) {
        // Register new user (don't auto-login - user needs to sign in manually)
        await authService.register(
          email: _emailController.text.trim(),
          password: _passwordController.text,
          name: _nameController.text.trim(),
          companyName: _companyNameController.text.trim().isEmpty
              ? null
              : _companyNameController.text.trim(),
          autoLogin: false, // Don't auto-login after registration
        );

        // Registration successful - show success message and switch to login mode
        if (mounted) {
          // Show success message
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.white),
                  const SizedBox(width: 8),
                  Expanded(
                    child: SelectableText(
                      'Registration successful! Please sign in with your email and password.',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14,
                      ),
                      enableInteractiveSelection: true,
                      toolbarOptions: const ToolbarOptions(
                        copy: true,
                        selectAll: true,
                      ),
                    ),
                  ),
                ],
              ),
              backgroundColor: Colors.green,
              duration: const Duration(seconds: 5),
              action: SnackBarAction(
                label: 'Dismiss',
                textColor: Colors.white,
                onPressed: () {
                  ScaffoldMessenger.of(context).hideCurrentSnackBar();
                },
              ),
            ),
          );

          // Clear the form
          _emailController.clear();
          _passwordController.clear();
          _nameController.clear();
          _companyNameController.clear();
          _formKey.currentState?.reset();

          // Switch to login mode
          setState(() {
            _isRegisterMode = false;
            _obscurePassword = true;
          });

          // Clear any previous errors
          ScaffoldMessenger.of(context).clearSnackBars();
        }
      } else {
        // Login existing user
        await authService.login(
          _emailController.text.trim(),
          _passwordController.text,
        );

        // Login successful - navigate to dashboard
        if (mounted) {
          Navigator.of(context).pushReplacement(
            MaterialPageRoute(builder: (_) => const DashboardScreen()),
          );
        }
      }
    } catch (e) {
      if (!mounted) return;

      // Debug: Log the error for troubleshooting
      debugPrint('Registration/Login Error: $e');
      debugPrint('Error type: ${e.runtimeType}');
      if (e is DioException) {
        debugPrint('DioException - Status: ${e.response?.statusCode}, Data: ${e.response?.data}');
      }

      // Use new error handler
      if (e is DioException) {
        final apiError = e.toApiError();
        
        // Handle field-level validation errors
        if (apiError.hasFieldErrors) {
          setState(() {
            _fieldErrors = {};
            for (final fieldError in apiError.fieldErrors!) {
              // Map backend field names to form field names
              String formField = fieldError.field;
              if (formField == 'email') formField = 'email';
              if (formField == 'password') formField = 'password';
              if (formField == 'name') formField = 'name';
              if (formField == 'companyName') formField = 'companyName';
              _fieldErrors[formField] = fieldError.message;
            }
          });
        }
        
        // Handle special cases
        if (apiError.errorCode == ErrorCode.conflictError && _isRegisterMode && mounted) {
          _showAlreadyRegisteredDialog(_emailController.text.trim());
          return;
        }
        
        // Show user-friendly error message
        final friendlyMessage = apiError.getFriendlyMessage();
        
        // Show error snackbar
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(friendlyMessage),
              backgroundColor: Colors.red,
              duration: const Duration(seconds: 4),
            ),
          );
        }
      } else {
        // Handle regular Exception objects (from auth_service)
        final errorString = e.toString();
        String friendlyMessage = errorString;
        
        // Extract message from Exception("message") format
        if (errorString.startsWith('Exception: ')) {
          friendlyMessage = errorString.substring(11); // Remove "Exception: " prefix
        } else if (errorString.contains('Registration failed: ')) {
          friendlyMessage = errorString.replaceFirst('Exception: Registration failed: ', '');
        } else if (errorString.contains(':')) {
          final parts = errorString.split(':');
          if (parts.length > 1) {
            friendlyMessage = parts.sublist(1).join(':').trim();
          } else {
            friendlyMessage = errorString;
          }
        } else {
          friendlyMessage = errorString;
        }
        
        // Check for specific error patterns
        if (errorString.contains('email') && !errorString.contains('password')) {
          friendlyMessage = 'Please enter a valid email address.';
        } else if (errorString.contains('password')) {
          friendlyMessage = _isRegisterMode
              ? 'Password must be at least 8 characters long.'
              : 'Password is incorrect. Please try again.';
        } else if (errorString.contains('already registered')) {
          // Email already registered - show dialog with options
          if (_isRegisterMode && mounted) {
            _showAlreadyRegisteredDialog(_emailController.text.trim());
            return; // Don't show error snackbar, dialog handles it
          }
          friendlyMessage = 'This email is already registered. Please sign in instead.';
        } else if (errorString.contains('Network error')) {
          friendlyMessage = 'Network error. Please check your connection and try again.';
      }

        // Show error snackbar
        if (mounted) {
      CopyableErrorSnackBar.show(
        context,
            friendlyMessage,
            errorCode: null,
      );
        }
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final scaffold = Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Semantics(
                    label: 'InvoiceMe login',
                    child: const Icon(
                      Icons.receipt_long,
                      size: 80,
                      color: Color(0xFF4a90e2),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Semantics(
                    label: 'InvoiceMe',
                    child: const Text(
                      'InvoiceMe',
                      style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF4a90e2),
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _isRegisterMode ? 'Create your account' : 'Sign in to continue',
                    style: TextStyle(
                      fontSize: 16,
                      color: Colors.grey[600],
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),
                  if (_isRegisterMode) ...[
                    TextFormField(
                      controller: _nameController,
                      textInputAction: TextInputAction.next,
                      decoration: InputDecoration(
                        labelText: 'Full Name',
                        prefixIcon: const Icon(Icons.person),
                        border: const OutlineInputBorder(),
                        errorText: _fieldErrors['name'],
                      ),
                      enableInteractiveSelection: true,
                      enableSuggestions: true,
                      enableIMEPersonalizedLearning: true,
                      contextMenuBuilder: (context, editableTextState) {
                        return AdaptiveTextSelectionToolbar.editableText(
                          editableTextState: editableTextState,
                        );
                      },
                      validator: (value) {
                        if (value == null || value.trim().isEmpty) {
                          return 'Please enter your name';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _companyNameController,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Company Name (Optional)',
                        prefixIcon: Icon(Icons.business),
                        border: OutlineInputBorder(),
                      ),
                      enableInteractiveSelection: true,
                      enableSuggestions: true,
                      enableIMEPersonalizedLearning: true,
                      contextMenuBuilder: (context, editableTextState) {
                        return AdaptiveTextSelectionToolbar.editableText(
                          editableTextState: editableTextState,
                        );
                      },
                    ),
                    const SizedBox(height: 16),
                  ],
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      decoration: InputDecoration(
                        labelText: 'Email',
                        prefixIcon: const Icon(Icons.email),
                        border: const OutlineInputBorder(),
                        errorText: _fieldErrors['email'],
                      ),
                    enableInteractiveSelection: true,
                    enableSuggestions: true,
                    enableIMEPersonalizedLearning: true,
                    contextMenuBuilder: (context, editableTextState) {
                      return AdaptiveTextSelectionToolbar.editableText(
                        editableTextState: editableTextState,
                      );
                    },
                    validator: (value) {
                      final email = value?.trim() ?? '';
                      if (email.isEmpty) {
                        return 'Please enter your email';
                      }
                      if (!_emailRegex.hasMatch(email)) {
                        return 'Please enter a valid email';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _passwordController,
                    obscureText: _obscurePassword,
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) => _isLoading ? null : _handleSubmit(),
                    decoration: InputDecoration(
                      labelText: 'Password',
                      prefixIcon: const Icon(Icons.lock),
                      border: const OutlineInputBorder(),
                      errorText: _fieldErrors['password'],
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscurePassword ? Icons.visibility_off : Icons.visibility,
                        ),
                        onPressed: () {
                          setState(() {
                            _obscurePassword = !_obscurePassword;
                          });
                        },
                        tooltip: _obscurePassword ? 'Show password' : 'Hide password',
                      ),
                    ),
                    enableInteractiveSelection: true,
                    enableSuggestions: false, // Disable suggestions for passwords
                    enableIMEPersonalizedLearning: false, // Disable for passwords
                    contextMenuBuilder: (context, editableTextState) {
                      return AdaptiveTextSelectionToolbar.editableText(
                        editableTextState: editableTextState,
                      );
                    },
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'Please enter your password';
                      }
                      if (value.length < 8) {
                        return 'Password must be at least 8 characters';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: _isLoading ? null : _handleSubmit,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF4a90e2),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: _isLoading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                            ),
                          )
                        : Text(_isRegisterMode ? 'Register' : 'Sign In'),
                  ),
                  const SizedBox(height: 16),
                  TextButton(
                    onPressed: _isLoading
                        ? null
                        : () {
                            setState(() {
                              _isRegisterMode = !_isRegisterMode;
                            });
                          },
                    child: Text(
                      _isRegisterMode
                          ? 'Already have an account? Sign in'
                          : 'Don\'t have an account? Register',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    
    // Wrap with MobileViewWrapper for consistent mobile-like layout on all platforms
    return MobileViewWrapper(
      child: scaffold,
      maxWidth: 500, // Slightly narrower for login screen
    );
  }
}

