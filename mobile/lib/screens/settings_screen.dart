// Dart imports
import 'dart:convert';
import 'dart:io' show Platform;

// Flutter imports
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart' show kIsWeb;

// Package imports
import 'package:dio/dio.dart';
import 'package:dio/dio.dart' show FormData, MultipartFile, Options, ResponseType;
import 'package:file_picker/file_picker.dart';
import 'package:flutter_colorpicker/flutter_colorpicker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../core/providers/providers.dart';
import '../core/services/share_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Local imports - Core
import '../core/database/database_helper.dart';
import '../core/providers/providers.dart';
import '../core/providers/refresh_provider.dart';
import '../core/providers/theme_provider.dart';
import '../core/services/csv_service.dart';

// Local imports - Screens
import 'api_keys_screen.dart';
import 'feedback_screen.dart';
import 'login_screen.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  PackageInfo? _packageInfo;
  int _refreshKey = 0; // Key to force rebuild when settings change

  @override
  void initState() {
    super.initState();
    _loadPackageInfo();
  }
  
  /// Force refresh of settings screen
  void _refreshSettings() {
    setState(() {
      _refreshKey++;
    });
  }

  Future<void> _loadPackageInfo() async {
    final packageInfo = await PackageInfo.fromPlatform();
    if (!mounted) return;
    setState(() {
      _packageInfo = packageInfo;
    });
  }

  @override
  Widget build(BuildContext context) {
    final authService = ref.read(authServiceProvider);
    final syncService = ref.read(syncServiceProvider);
    // Watch for user changes - this will rebuild when user is updated
    final user = authService.currentUser;
    
    // Force rebuild when theme changes
    ref.watch(themeProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        elevation: 0,
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          // Responsive padding: smaller on mobile, larger on web
          final padding = kIsWeb 
              ? EdgeInsets.symmetric(
                  horizontal: constraints.maxWidth > 1200 ? 48.0 : 
                             constraints.maxWidth > 800 ? 32.0 : 16.0,
                  vertical: 16.0,
                )
              : const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0);
          
          return ListView(
            key: ValueKey(_refreshKey), // Force rebuild when key changes
            physics: const AlwaysScrollableScrollPhysics(),
            padding: padding,
            children: [
              // User Profile Card
              if (user != null) ...[
                _UserProfileCard(user: user),
                SizedBox(height: kIsWeb ? 16 : 12),
              ],

              // Account Section
              _SectionCard(
                title: 'Account',
                icon: Icons.person,
                children: [
                  if (user != null) ...[
                    _ProfileEditTile(user: user, onProfileUpdated: _refreshSettings),
                    _SecurityTile(),
                  ],
                ],
              ),
              SizedBox(height: kIsWeb ? 16 : 12),

              // Appearance Section
              _SectionCard(
                title: 'Appearance',
                icon: Icons.palette,
                children: [
                  _ThemeTile(),
                ],
              ),
              SizedBox(height: kIsWeb ? 16 : 12),

              // PDF Customization Section
              _SectionCard(
                title: 'PDF Customization',
                icon: Icons.picture_as_pdf,
                children: [
                  _PdfSettingsTile(),
                ],
              ),
              SizedBox(height: kIsWeb ? 16 : 12),

              // Data & Sync Section
              _SectionCard(
                title: 'Data & Sync',
                icon: Icons.cloud_sync,
                children: [
                  _SyncTile(syncService: syncService),
                  _DataManagementTile(),
                ],
              ),
              SizedBox(height: kIsWeb ? 16 : 12),

              // Developer Section
              _SectionCard(
                title: 'Developer',
                icon: Icons.code,
                children: [
                  _ApiKeysTile(),
                ],
              ),
              SizedBox(height: kIsWeb ? 16 : 12),

              // Support Section
              _SectionCard(
                title: 'Support',
                icon: Icons.help_outline,
                children: [
                  _FeedbackTile(),
                  _AboutTile(packageInfo: _packageInfo),
                ],
              ),
              SizedBox(height: kIsWeb ? 16 : 12),

              // Danger Zone
              if (user != null) ...[
                _SectionCard(
                  title: 'Danger Zone',
                  icon: Icons.warning,
                  titleColor: Colors.red,
                  children: [
                    _GdprTile(),
                    _LogoutTile(),
                  ],
                ),
                SizedBox(height: kIsWeb ? 16 : 12),
              ],
            ],
          );
        },
      ),
    );
  }
}

// User Profile Card
class _UserProfileCard extends StatelessWidget {
  final dynamic user;

  const _UserProfileCard({required this.user});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: EdgeInsets.all(kIsWeb ? 16 : 12),
        child: Row(
          children: [
            CircleAvatar(
              radius: kIsWeb ? 30 : 25,
              backgroundColor: Theme.of(context).primaryColor,
              child: Text(
                (user.name?.isNotEmpty ?? false) ? user.name![0].toUpperCase() : '?',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            SizedBox(width: kIsWeb ? 16 : 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    user.name,
                    style: TextStyle(
                      fontSize: kIsWeb ? 18 : 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  SizedBox(height: kIsWeb ? 4 : 2),
                  Text(
                    user.email,
                    style: TextStyle(
                      fontSize: kIsWeb ? 14 : 13,
                      color: Colors.grey[600],
                    ),
                  ),
                  if (user.companyName != null && user.companyName.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(Icons.business, size: 14, color: Colors.grey[500]),
                        const SizedBox(width: 4),
                        Text(
                          user.companyName,
                          style: TextStyle(
                            fontSize: 13,
                            color: Colors.grey[500],
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// Section Card Widget
class _SectionCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final List<Widget> children;
  final Color? titleColor;

  const _SectionCard({
    required this.title,
    required this.icon,
    required this.children,
    this.titleColor,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(
              kIsWeb ? 16 : 12, 
              kIsWeb ? 16 : 12, 
              kIsWeb ? 16 : 12, 
              kIsWeb ? 8 : 6,
            ),
            child: Row(
              children: [
                Icon(
                  icon, 
                  color: titleColor ?? Theme.of(context).primaryColor, 
                  size: kIsWeb ? 20 : 18,
                ),
                SizedBox(width: kIsWeb ? 8 : 6),
                Text(
                  title,
                  style: TextStyle(
                    fontSize: kIsWeb ? 16 : 15,
                    fontWeight: FontWeight.bold,
                    color: titleColor ?? Theme.of(context).textTheme.titleLarge?.color,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          ...children,
        ],
      ),
    );
  }
}

// Profile Edit Tile
class _ProfileEditTile extends ConsumerStatefulWidget {
  final dynamic user;
  final VoidCallback? onProfileUpdated;

  const _ProfileEditTile({required this.user, this.onProfileUpdated});

  @override
  ConsumerState<_ProfileEditTile> createState() => _ProfileEditTileState();
}

class _ProfileEditTileState extends ConsumerState<_ProfileEditTile> {
  bool _isLoading = false;

  Future<void> _showEditProfileDialog() async {
    final nameController = TextEditingController(text: widget.user.name);
    final companyController = TextEditingController(text: widget.user.companyName ?? '');
    final formKey = GlobalKey<FormState>();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit Profile'),
        content: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextFormField(
                  controller: nameController,
                  decoration: const InputDecoration(
                    labelText: 'Full Name',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.person),
                  ),
                  validator: (value) {
                    if (value == null || value.isEmpty) {
                      return 'Please enter your name';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: companyController,
                  decoration: const InputDecoration(
                    labelText: 'Company Name (Optional)',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.business),
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: _isLoading ? null : () async {
              if (formKey.currentState!.validate()) {
                setState(() => _isLoading = true);
                try {
                  final authService = ref.read(authServiceProvider);
                  await authService.updateProfile(
                    name: nameController.text.trim(),
                    companyName: companyController.text.trim().isEmpty ? null : companyController.text.trim(),
                  );
                  
                  // Reload user data to ensure UI reflects changes
                  await authService.initialize();
                  
                  if (mounted) {
                    Navigator.pop(context);
                    // Trigger parent Settings screen to refresh
                    widget.onProfileUpdated?.call();
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Profile updated successfully!'),
                        backgroundColor: Colors.green,
                      ),
                    );
                }
              } catch (e) {
                  if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                        content: Text('Error updating profile: ${e.toString().replaceFirst('Exception: ', '')}'),
                      backgroundColor: Colors.red,
                        duration: const Duration(seconds: 4),
                    ),
                  );
                }
                } finally {
                  if (mounted) {
                    setState(() => _isLoading = false);
              }
                }
              }
            },
            child: _isLoading
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.edit_outlined),
      title: const Text('Edit Profile'),
      subtitle: const Text('Update your name and company'),
      trailing: const Icon(Icons.chevron_right),
      onTap: _showEditProfileDialog,
    );
  }
}

// Security Tile
class _SecurityTile extends ConsumerWidget {
  const _SecurityTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      leading: const Icon(Icons.lock_outline),
      title: const Text('Change Password'),
      subtitle: const Text('Update your account password'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => _showChangePasswordDialog(context, ref),
    );
  }

  void _showChangePasswordDialog(BuildContext context, WidgetRef ref) {
    final currentPasswordController = TextEditingController();
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();
    final formKey = GlobalKey<FormState>();
    bool obscureCurrentPassword = true;
    bool obscureNewPassword = true;
    bool obscureConfirmPassword = true;
    bool isLoading = false;

    showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Change Password'),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextFormField(
                    controller: currentPasswordController,
                    obscureText: obscureCurrentPassword,
                    decoration: InputDecoration(
                      labelText: 'Current Password',
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.lock),
                      suffixIcon: IconButton(
                        icon: Icon(
                          obscureCurrentPassword ? Icons.visibility : Icons.visibility_off,
                        ),
                        onPressed: () {
                          setState(() {
                            obscureCurrentPassword = !obscureCurrentPassword;
                          });
                        },
                      ),
                    ),
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'Please enter your current password';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: newPasswordController,
                    obscureText: obscureNewPassword,
                    decoration: InputDecoration(
                      labelText: 'New Password',
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.lock_outline),
                      helperText: 'Must be at least 8 characters',
                      suffixIcon: IconButton(
                        icon: Icon(
                          obscureNewPassword ? Icons.visibility : Icons.visibility_off,
                        ),
                        onPressed: () {
                          setState(() {
                            obscureNewPassword = !obscureNewPassword;
                          });
                        },
                      ),
                    ),
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'Please enter a new password';
                      }
                      if (value.length < 8) {
                        return 'Password must be at least 8 characters';
                      }
                      if (value == currentPasswordController.text) {
                        return 'New password must be different';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: confirmPasswordController,
                    obscureText: obscureConfirmPassword,
                    decoration: InputDecoration(
                      labelText: 'Confirm New Password',
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(
                          obscureConfirmPassword ? Icons.visibility : Icons.visibility_off,
                        ),
                        onPressed: () {
                          setState(() {
                            obscureConfirmPassword = !obscureConfirmPassword;
                          });
                        },
                      ),
                    ),
                    validator: (value) {
                      if (value == null || value.isEmpty) {
                        return 'Please confirm your new password';
                      }
                      if (value != newPasswordController.text) {
                        return 'Passwords do not match';
                      }
                      return null;
                    },
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: isLoading
                  ? null
                  : () {
                      Navigator.of(context).pop();
                    },
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: isLoading
                  ? null
                  : () async {
                      if (formKey.currentState!.validate()) {
                        setState(() {
                          isLoading = true;
                        });

                        try {
                          final authService = ref.read(authServiceProvider);
                          await authService.changePassword(
                            currentPasswordController.text,
                            newPasswordController.text,
                          );

                          if (context.mounted) {
                            Navigator.of(context).pop();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Password changed successfully!'),
                                backgroundColor: Colors.green,
                              ),
                            );
                          }
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(e.toString().replaceFirst('Exception: ', '')),
                                backgroundColor: Colors.red,
                              ),
                            );
                          }
                        } finally {
                          if (context.mounted) {
                            setState(() {
                              isLoading = false;
                            });
                          }
                        }
                      }
                    },
              child: isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Change Password'),
            ),
          ],
        ),
      ),
    );
  }
}

// Theme Tile
class _ThemeTile extends ConsumerWidget {
  const _ThemeTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentTheme = ref.watch(themeProvider);
    final themeNotifier = ref.read(themeProvider.notifier);

    return ListTile(
      leading: const Icon(Icons.brightness_6),
      title: const Text('Theme'),
      subtitle: Text(_getThemeName(currentTheme)),
      trailing: PopupMenuButton<AppTheme>(
        icon: const Icon(Icons.chevron_right),
        onSelected: (theme) async {
          await themeNotifier.setTheme(theme);
          // Theme change is immediate via Riverpod - the ref.watch(themeProvider) in build() will trigger rebuild
        },
        itemBuilder: (context) => [
          const PopupMenuItem(
            value: AppTheme.light,
            child: Row(
              children: [
                Icon(Icons.light_mode, size: 20),
                SizedBox(width: 8),
                Text('Light'),
              ],
            ),
          ),
          const PopupMenuItem(
            value: AppTheme.dark,
            child: Row(
              children: [
                Icon(Icons.dark_mode, size: 20),
                SizedBox(width: 8),
                Text('Dark'),
              ],
            ),
          ),
          const PopupMenuItem(
            value: AppTheme.system,
            child: Row(
              children: [
                Icon(Icons.brightness_auto, size: 20),
                SizedBox(width: 8),
                Text('System Default'),
              ],
            ),
          ),
        ],
          ),
        );
  }

  String _getThemeName(AppTheme theme) {
    switch (theme) {
      case AppTheme.light:
        return 'Light';
      case AppTheme.dark:
        return 'Dark';
      case AppTheme.system:
        return 'System Default';
  }
}
}

// PDF Settings Tile
class _PdfSettingsTile extends ConsumerStatefulWidget {
  const _PdfSettingsTile();

  @override
  ConsumerState<_PdfSettingsTile> createState() => _PdfSettingsTileState();
}

class _PdfSettingsTileState extends ConsumerState<_PdfSettingsTile> {
  String? _logoUrl;
  Color _primaryColor = const Color(0xFF4a90e2);
  Color _secondaryColor = const Color(0xFF333333);
  String _fontFamily = 'Arial';
  String _layout = 'classic';
  bool _showLogo = true;
  bool _showClientDetails = true;
  bool _showInvoiceDetails = true;
  bool _showNotes = true;
  bool _showFooter = true;
  String _thankYouMessage = 'Thank you for your business!';
  final TextEditingController _thankYouController = TextEditingController();
  bool _isLoading = true;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  @override
  void dispose() {
    _thankYouController.dispose();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    try {
      final apiClient = ref.read(apiClientProvider);
      // Correct path: /user-settings (base URL already includes /api/v1)
      final response = await apiClient.get('/user-settings');
      
      // Handle both camelCase and snake_case responses
      final data = response.data;
      setState(() {
        _logoUrl = data['pdfLogoUrl'] ?? data['pdf_logo_url'];
        final primaryColorStr = data['pdfPrimaryColor'] ?? data['pdf_primary_color'] ?? '#4a90e2';
        final secondaryColorStr = data['pdfSecondaryColor'] ?? data['pdf_secondary_color'] ?? '#333333';
        _primaryColor = _hexToColor(primaryColorStr);
        _secondaryColor = _hexToColor(secondaryColorStr);
        _fontFamily = data['pdfFontFamily'] ?? data['pdf_font_family'] ?? 'Arial';
        _layout = (data['pdfLayout'] ?? data['pdf_layout'] ?? 'classic').toString();
        _showLogo = _readBool(data, 'pdfShowLogo', 'pdf_show_logo', true);
        _showClientDetails = _readBool(data, 'pdfShowClientDetails', 'pdf_show_client_details', true);
        _showInvoiceDetails = _readBool(data, 'pdfShowInvoiceDetails', 'pdf_show_invoice_details', true);
        _showNotes = _readBool(data, 'pdfShowNotes', 'pdf_show_notes', true);
        _showFooter = _readBool(data, 'pdfShowFooter', 'pdf_show_footer', true);
        _thankYouMessage = data['pdfThankYouMessage'] ??
            data['pdf_thank_you_message'] ??
            'Thank you for your business!';
        _thankYouController.text = _thankYouMessage;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error loading PDF settings: ${e.toString()}'),
            backgroundColor: Colors.orange,
          ),
        );
      }
    }
  }

  bool _readBool(Map<String, dynamic> data, String camelKey, String snakeKey, bool fallback) {
    dynamic value = data[camelKey];
    if (value == null) {
      value = data[snakeKey];
    }
    if (value == null) {
      return fallback;
    }
    if (value is bool) return value;
    if (value is num) return value != 0;
    if (value is String) {
      return value.toLowerCase() == 'true' || value == '1';
    }
    return fallback;
  }

  Color _hexToColor(String hex) {
    try {
      final hexClean = hex.replaceAll('#', '').trim();
      return Color(int.parse(hexClean, radix: 16) + 0xFF000000);
    } catch (e) {
      return const Color(0xFF4a90e2);
    }
  }

  String _colorToHex(Color color) {
    return '#${color.value.toRadixString(16).substring(2, 8).toUpperCase()}';
  }

  Future<void> _showColorPicker(Color currentColor, Function(Color) onColorChanged) async {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Pick a color'),
        content: SingleChildScrollView(
          child: BlockPicker(
            pickerColor: currentColor,
            onColorChanged: onColorChanged,
            availableColors: const [
              Color(0xFF4a90e2), // Blue
              Color(0xFF1E88E5), // Light Blue
              Color(0xFF1976D2), // Dark Blue
              Color(0xFF43A047), // Green
              Color(0xFF2E7D32), // Dark Green
              Color(0xFFF44336), // Red
              Color(0xFFD32F2F), // Dark Red
              Color(0xFFE91E63), // Pink
              Color(0xFF9C27B0), // Purple
              Color(0xFF673AB7), // Deep Purple
              Color(0xFF3F51B5), // Indigo
              Color(0xFF2196F3), // Light Blue
              Color(0xFF00BCD4), // Cyan
              Color(0xFF009688), // Teal
              Color(0xFF4CAF50), // Light Green
              Color(0xFF8BC34A), // Lime
              Color(0xFFFFC107), // Amber
              Color(0xFFFF9800), // Orange
              Color(0xFF795548), // Brown
              Color(0xFF607D8B), // Blue Grey
              Color(0xFF333333), // Dark Grey
              Color(0xFF000000), // Black
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  Future<void> _saveSettings() async {
    setState(() => _isSaving = true);
    try {
      final apiClient = ref.read(apiClientProvider);
      // Correct path: /user-settings (base URL already includes /api/v1)
      await apiClient.patch('/user-settings', data: {
        'pdfLogoUrl': _logoUrl,
        'pdfPrimaryColor': _colorToHex(_primaryColor),
        'pdfSecondaryColor': _colorToHex(_secondaryColor),
        'pdfFontFamily': _fontFamily,
        'pdfLayout': _layout,
        'pdfShowLogo': _showLogo,
        'pdfShowClientDetails': _showClientDetails,
        'pdfShowInvoiceDetails': _showInvoiceDetails,
        'pdfShowNotes': _showNotes,
        'pdfShowFooter': _showFooter,
        'pdfThankYouMessage': _thankYouMessage.trim().isEmpty ? null : _thankYouMessage.trim(),
      });
      if (mounted) {
        // Reload settings from backend to ensure UI reflects saved values
        await _loadSettings();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('PDF settings saved successfully!'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        String errorMsg = 'Error saving settings';
        if (e is DioException && e.response != null) {
          final data = e.response!.data;
          if (data is Map && data['message'] != null) {
            errorMsg = data['message'].toString();
          } else {
            errorMsg = 'HTTP ${e.response!.statusCode}: ${e.message}';
          }
        } else {
          errorMsg = e.toString();
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(errorMsg),
            backgroundColor: Colors.red,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isSaving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const ListTile(
        leading: CircularProgressIndicator(),
        title: Text('Loading PDF settings...'),
      );
    }

    return ExpansionTile(
      leading: const Icon(Icons.settings),
      title: const Text('PDF Customization'),
      subtitle: const Text('Customize invoice PDF appearance'),
      children: [
        // Logo URL
        ListTile(
          title: const Text('Logo URL'),
          subtitle: Text(_logoUrl ?? 'No logo set'),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_logoUrl != null && _logoUrl!.isNotEmpty)
                IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => setState(() => _logoUrl = null),
                  tooltip: 'Remove logo',
                ),
              IconButton(
                icon: const Icon(Icons.edit),
                onPressed: () => _showLogoUrlDialog(),
                tooltip: 'Edit logo URL',
              ),
            ],
          ),
        ),
        const Divider(height: 1),

        // Primary Color
        ListTile(
          title: const Text('Primary Color'),
          subtitle: Text(_colorToHex(_primaryColor)),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: _primaryColor,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.grey.shade300),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
            icon: const Icon(Icons.color_lens),
                onPressed: () => _showColorPicker(_primaryColor, (color) {
                  setState(() => _primaryColor = color);
                  Navigator.pop(context);
                }),
                tooltip: 'Pick color',
              ),
            ],
          ),
        ),
        const Divider(height: 1),

        // Secondary Color
        ListTile(
          title: const Text('Secondary Color'),
          subtitle: Text(_colorToHex(_secondaryColor)),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: _secondaryColor,
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.grey.shade300),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
            icon: const Icon(Icons.color_lens),
                onPressed: () => _showColorPicker(_secondaryColor, (color) {
                  setState(() => _secondaryColor = color);
                  Navigator.pop(context);
                }),
                tooltip: 'Pick color',
              ),
            ],
          ),
        ),
        const Divider(height: 1),

        // Font Family
        ListTile(
          title: const Text('Font Family'),
          subtitle: Text(_fontFamily),
          trailing: DropdownButton<String>(
            value: _fontFamily,
            items: const [
              DropdownMenuItem(value: 'Arial', child: Text('Arial')),
              DropdownMenuItem(value: 'Helvetica', child: Text('Helvetica')),
              DropdownMenuItem(value: 'Times New Roman', child: Text('Times New Roman')),
              DropdownMenuItem(value: 'Courier New', child: Text('Courier New')),
              DropdownMenuItem(value: 'Georgia', child: Text('Georgia')),
              DropdownMenuItem(value: 'Verdana', child: Text('Verdana')),
            ],
            onChanged: (value) => setState(() => _fontFamily = value!),
          ),
        ),
        const Divider(height: 1),

        // Layout selection
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: DropdownButtonFormField<String>(
            value: _layout,
            decoration: const InputDecoration(
              labelText: 'Layout Style',
              border: OutlineInputBorder(),
            ),
            items: const [
              DropdownMenuItem(value: 'classic', child: Text('Classic (detailed)')),
              DropdownMenuItem(value: 'minimal', child: Text('Minimal (clean)')),
            ],
            onChanged: (value) {
              if (value == null) return;
              setState(() => _layout = value);
            },
          ),
        ),

        // Toggles
        SwitchListTile.adaptive(
          title: const Text('Show Logo'),
          subtitle: const Text('Display company logo in header'),
          value: _showLogo,
          onChanged: (value) => setState(() => _showLogo = value),
        ),
        SwitchListTile.adaptive(
          title: const Text('Show Client Details'),
          subtitle: const Text('Display Bill To section'),
          value: _showClientDetails,
          onChanged: (value) => setState(() => _showClientDetails = value),
        ),
        SwitchListTile.adaptive(
          title: const Text('Show Invoice Details'),
          subtitle: const Text('Display metadata block (currency, type, etc.)'),
          value: _showInvoiceDetails,
          onChanged: (value) => setState(() => _showInvoiceDetails = value),
        ),
        SwitchListTile.adaptive(
          title: const Text('Show Notes'),
          subtitle: const Text('Include notes when invoice has notes'),
          value: _showNotes,
          onChanged: (value) => setState(() => _showNotes = value),
        ),
        SwitchListTile.adaptive(
          title: const Text('Show Footer'),
          subtitle: const Text('Display thank-you message at bottom of PDF'),
          value: _showFooter,
          onChanged: (value) => setState(() => _showFooter = value),
        ),

        // Thank you message
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: TextField(
            controller: _thankYouController,
            maxLines: 2,
            maxLength: 200,
            decoration: const InputDecoration(
              labelText: 'Thank-you Message',
              hintText: 'Thank you for your business!',
              border: OutlineInputBorder(),
            ),
            onChanged: (value) => _thankYouMessage = value,
          ),
        ),

        // Save Button
        Padding(
          padding: const EdgeInsets.all(16.0),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _isSaving ? null : _saveSettings,
              icon: _isSaving
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save),
              label: Text(_isSaving ? 'Saving...' : 'Save PDF Settings'),
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
              ),
            ),
          ),
        ),
      ],
    );
  }

  void _showLogoUrlDialog() {
    final controller = TextEditingController(text: _logoUrl);
    final formKey = GlobalKey<FormState>();
    
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Logo URL'),
        content: Form(
          key: formKey,
          child: TextFormField(
            controller: controller,
            decoration: const InputDecoration(
              labelText: 'Enter logo URL',
              hintText: 'https://example.com/logo.png',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.link),
              helperText: 'Must be a publicly accessible image URL',
            ),
            keyboardType: TextInputType.url,
            validator: (value) {
              if (value != null && value.isNotEmpty) {
                final trimmed = value.trim();
                if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
                  return 'URL must start with http:// or https://';
                }
                try {
                  Uri.parse(trimmed);
                } catch (e) {
                  return 'Invalid URL format';
                }
              }
              return null;
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              if (formKey.currentState!.validate()) {
                setState(() {
                  _logoUrl = controller.text.isEmpty ? null : controller.text.trim();
                });
                Navigator.pop(context);
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
}

// Enhanced Sync Tile with status tracking
class _SyncTile extends ConsumerStatefulWidget {
  final dynamic syncService;

  const _SyncTile({required this.syncService});

  @override
  ConsumerState<_SyncTile> createState() => _SyncTileState();
}

class _SyncTileState extends ConsumerState<_SyncTile> {
  bool _isSyncing = false;
  String? _lastSyncTime;
  String? _syncStatus;
  int _pendingChanges = 0;
  Map<String, int>? _lastSyncStats;

  @override
  void initState() {
    super.initState();
    _loadSyncInfo();
  }

  Future<void> _loadSyncInfo() async {
    if (widget.syncService == null) return;
    
    try {
      final prefs = await SharedPreferences.getInstance();
      final lastSync = prefs.getString('last_sync_timestamp');
      
      if (lastSync != null) {
        final dateTime = DateTime.parse(lastSync);
        final now = DateTime.now();
        final difference = now.difference(dateTime);
        
        String timeAgo;
        if (difference.inMinutes < 1) {
          timeAgo = 'Just now';
        } else if (difference.inMinutes < 60) {
          timeAgo = '${difference.inMinutes}m ago';
        } else if (difference.inHours < 24) {
          timeAgo = '${difference.inHours}h ago';
        } else {
          timeAgo = '${difference.inDays}d ago';
        }
        
        setState(() {
          _lastSyncTime = timeAgo;
        });
      }
      
      // Get pending changes count
      final db = await DatabaseHelper.getDatabase();
      final pending = await db.query(
        'pending_changes',
        where: 'synced = ?',
        whereArgs: [0],
      );
      
      if (mounted) {
        setState(() {
          _pendingChanges = pending.length;
        });
      }
    } catch (e) {
      print('Error loading sync info: $e');
    }
  }

  Future<void> _performSync() async {
    if (widget.syncService == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sync not available on web platform'),
            backgroundColor: Colors.orange,
          ),
        );
      }
      return;
    }

    setState(() {
      _isSyncing = true;
      _syncStatus = 'Starting sync...';
    });

    try {
      // Show progress dialog
      if (mounted) {
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (context) => _SyncProgressDialog(
            status: _syncStatus ?? 'Syncing...',
            onCancel: () {
              // Sync can't be cancelled easily, but we can close the dialog
              Navigator.of(context).pop();
            },
          ),
        );
      }

      // Update status during sync
      setState(() => _syncStatus = 'Pushing local changes...');
      
      // Perform sync
      await widget.syncService.sync();
      
      // Get sync statistics
      final prefs = await SharedPreferences.getInstance();
      final lastSync = prefs.getString('last_sync_timestamp');
      
      if (mounted) {
        Navigator.of(context).pop(); // Close progress dialog
        
        // Reload sync info
        await _loadSyncInfo();
        
        // Show success message with stats
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Sync completed successfully',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      if (_lastSyncTime != null)
                        Text(
                          'Last synced: $_lastSyncTime',
                          style: const TextStyle(fontSize: 12),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            backgroundColor: Colors.green,
            duration: const Duration(seconds: 3),
          ),
        );
        
        // Trigger refresh of invoices and clients screens
        triggerRefresh(ref, RefreshType.all);
      }
    } catch (e) {
      if (mounted) {
        Navigator.of(context).pop(); // Close progress dialog if still open
        
        String errorMsg = 'Sync failed';
        if (e.toString().contains('network') || e.toString().contains('connection')) {
          errorMsg = 'Network error. Please check your connection.';
        } else if (e.toString().contains('401') || e.toString().contains('unauthorized')) {
          errorMsg = 'Authentication failed. Please log in again.';
        } else {
          errorMsg = 'Sync failed: ${e.toString().split('\n').first}';
        }
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(errorMsg),
                ),
              ],
            ),
            backgroundColor: Colors.red,
            duration: const Duration(seconds: 4),
            action: SnackBarAction(
              label: 'Retry',
              textColor: Colors.white,
              onPressed: () => _performSync(),
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSyncing = false;
          _syncStatus = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.syncService == null) {
      return ListTile(
        leading: const Icon(Icons.cloud_off, color: Colors.grey),
        title: const Text('Sync'),
        subtitle: const Text('Not available on web platform'),
        enabled: false,
      );
    }

    return Column(
      children: [
        ListTile(
          leading: _isSyncing
              ? SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      Theme.of(context).colorScheme.primary,
                    ),
                  ),
                )
              : Icon(
                  _pendingChanges > 0 ? Icons.sync_problem : Icons.sync,
                  color: _pendingChanges > 0 ? Colors.orange : null,
                ),
          title: const Text('Sync Now'),
          subtitle: _buildSubtitle(),
          trailing: _isSyncing
              ? null
              : IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: _isSyncing ? null : _performSync,
                  tooltip: 'Sync now',
                ),
          onTap: _isSyncing ? null : _performSync,
        ),
        if (_pendingChanges > 0 && !_isSyncing)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.orange[50],
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.orange[200]!),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: Colors.orange[700], size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '$_pendingChanges pending change${_pendingChanges == 1 ? '' : 's'} waiting to sync',
                      style: TextStyle(
                        color: Colors.orange[900],
                        fontSize: 13,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildSubtitle() {
    if (_isSyncing) {
      return Text(_syncStatus ?? 'Syncing...');
    }
    
    if (_lastSyncTime != null) {
      return Text('Last synced: $_lastSyncTime');
    }
    
    return const Text('Sync offline changes with server');
  }
}

// Sync Progress Dialog
class _SyncProgressDialog extends StatefulWidget {
  final String status;
  final VoidCallback onCancel;

  const _SyncProgressDialog({
    required this.status,
    required this.onCancel,
  });

  @override
  State<_SyncProgressDialog> createState() => _SyncProgressDialogState();
}

class _SyncProgressDialogState extends State<_SyncProgressDialog> {
  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          const SizedBox(height: 24),
          Text(
            widget.status,
            style: Theme.of(context).textTheme.bodyMedium,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// Data Management Tile
class _DataManagementTile extends ConsumerWidget {
  const _DataManagementTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      leading: const Icon(Icons.storage),
      title: const Text('Data Management'),
      subtitle: const Text('Export data or clear cache'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => _showDataManagementDialog(context, ref),
    );
  }

  void _showDataManagementDialog(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Data Management'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.download),
                title: const Text('Export Data (JSON)'),
                subtitle: const Text('Export all your data in JSON format'),
                onTap: () => _exportDataFromDialog(context, ref),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.table_chart),
                title: const Text('Export to CSV'),
                subtitle: const Text('Export invoices or clients as CSV'),
                onTap: () => _showCsvExportDialog(context, ref),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.upload_file),
                title: const Text('Import from CSV'),
                subtitle: const Text('Import invoices or clients from CSV file'),
                onTap: () => _showCsvImportDialog(context, ref),
              ),
              const Divider(),
              ListTile(
                leading: const Icon(Icons.delete_sweep, color: Colors.orange),
                title: const Text('Clear Cache'),
                subtitle: const Text('Clear app cache and temporary files'),
                onTap: () => _clearCache(context, ref),
              ),
            ],
          ),
        ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
                  ),
        ],
      ),
    );
  }

  static Future<void> _showCsvExportDialog(BuildContext context, WidgetRef ref) async {
    Navigator.pop(context); // Close the data management dialog
    
    final choice = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Export to CSV'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.people),
              title: const Text('Export Clients'),
              onTap: () => Navigator.pop(context, 'clients'),
            ),
            ListTile(
              leading: const Icon(Icons.receipt),
              title: const Text('Export Invoices'),
              onTap: () => Navigator.pop(context, 'invoices'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
    
    if (choice == null) return;
    
    // Show loading dialog
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Text('Exporting to CSV...'),
          ],
        ),
      ),
    );
    
    try {
      final apiClient = ref.read(apiClientProvider);
      final endpoint = choice == 'clients' ? '/clients/export/csv' : '/invoices/export/csv';
      
      // Get CSV as text (backend should return CSV as text/csv)
      final response = await apiClient.get(endpoint);
      
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        
        // Response data should be CSV string
        final csvData = response.data is String 
            ? response.data 
            : response.data.toString();
        
        // Share the CSV file
        final shareService = ref.read(shareServiceProvider);
        await shareService.shareText(
          text: csvData,
          context: context,
          subject: 'InvoiceMe ${choice == 'clients' ? 'Clients' : 'Invoices'} Export',
        );
        
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white),
                const SizedBox(width: 12),
                Text('${choice == 'clients' ? 'Clients' : 'Invoices'} exported successfully'),
              ],
            ),
            backgroundColor: Colors.green,
            duration: const Duration(seconds: 3),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error exporting CSV: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  static Future<void> _showCsvImportDialog(BuildContext context, WidgetRef ref) async {
    Navigator.pop(context); // Close the data management dialog
    
    final choice = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Import from CSV'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.people),
              title: const Text('Import Clients'),
              onTap: () => Navigator.pop(context, 'clients'),
            ),
            ListTile(
              leading: const Icon(Icons.receipt),
              title: const Text('Import Invoices'),
              onTap: () => Navigator.pop(context, 'invoices'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
    
    if (choice == null) return;
    
    try {
      // Pick CSV file
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['csv'],
      );
      
      if (result == null || result.files.single.bytes == null) return;
      
      // Show loading dialog
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (context) => const AlertDialog(
          content: Row(
            children: [
              CircularProgressIndicator(),
              SizedBox(width: 16),
              Text('Importing from CSV...'),
            ],
          ),
        ),
      );
      
      final apiClient = ref.read(apiClientProvider);
      final endpoint = choice == 'clients' ? '/clients/import/csv' : '/invoices/import/csv';
      
      // Create multipart form data
      final formData = FormData.fromMap({
        'file': MultipartFile.fromBytes(
          result.files.single.bytes!,
          filename: result.files.single.name,
        ),
      });
      
      final response = await apiClient.postMultipart(
        endpoint,
        formData,
      );
      
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        
        final importedCount = response.data['importedCount'] ?? 0;
        final errors = response.data['errors'] as List<dynamic>? ?? [];
        
        if (errors.isEmpty) {
          // Trigger refresh to update invoices/clients screens
          final refreshType = choice == 'clients' ? RefreshType.clients : RefreshType.invoices;
          triggerRefresh(ref, refreshType);
          triggerRefresh(ref, RefreshType.dashboard); // Also refresh dashboard
          
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Row(
                children: [
                  const Icon(Icons.check_circle, color: Colors.white),
                  const SizedBox(width: 12),
                  Text('Successfully imported $importedCount ${choice == 'clients' ? 'clients' : 'invoices'}'),
                ],
              ),
              backgroundColor: Colors.green,
              duration: const Duration(seconds: 3),
            ),
          );
        } else {
          // Show errors
          showDialog(
            context: context,
            builder: (context) => AlertDialog(
              title: const Text('Import Completed with Errors'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Imported: $importedCount ${choice == 'clients' ? 'clients' : 'invoices'}'),
                    const SizedBox(height: 16),
                    const Text('Errors:', style: TextStyle(fontWeight: FontWeight.bold)),
                    ...errors.take(10).map((error) => Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('• $error', style: const TextStyle(fontSize: 12)),
                    )),
                    if (errors.length > 10)
                      Text('... and ${errors.length - 10} more errors'),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('OK'),
                ),
              ],
            ),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        if (Navigator.canPop(context)) Navigator.pop(context); // Close loading dialog
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error importing CSV: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  static Future<void> _exportDataFromDialog(BuildContext context, WidgetRef ref) async {
    Navigator.pop(context);
    
    // Show loading dialog
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Text('Exporting data...'),
          ],
        ),
      ),
    );

    try {
      final apiClient = ref.read(apiClientProvider);
      // Correct path: /gdpr/export (base URL already includes /api/v1)
      final response = await apiClient.get('/gdpr/export');
      
      // Convert to JSON string for sharing
      final jsonString = jsonEncode(response.data);
      
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        final shareService = ref.read(shareServiceProvider);
        await shareService.shareText(
          text: jsonString,
          context: context,
          subject: 'InvoiceMe Data Export',
        );
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Row(
              children: [
                Icon(Icons.check_circle, color: Colors.white),
                SizedBox(width: 12),
                Text('Data exported successfully'),
              ],
            ),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 3),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        String errorMsg = 'Error exporting data';
        if (e is DioException) {
          if (e.response?.statusCode == 401) {
            errorMsg = 'Authentication failed. Please log in again.';
          } else if (e.type == DioExceptionType.connectionError) {
            errorMsg = 'Network error. Please check your connection.';
          } else {
            errorMsg = 'Error: ${e.message ?? e.toString()}';
          }
        } else {
          errorMsg = 'Error: ${e.toString()}';
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(child: Text(errorMsg)),
              ],
            ),
            backgroundColor: Colors.red,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    }
  }

  static Future<void> _clearCache(BuildContext context, WidgetRef ref) async {
    Navigator.pop(context);
    try {
      final prefs = await SharedPreferences.getInstance();
      
      // Clear all SharedPreferences except auth-related data
      final keys = prefs.getKeys();
      for (final key in keys) {
        // Keep auth-related keys
        if (!key.startsWith('secure_') && 
            key != 'user_data' && 
            key != 'user_id' &&
            key != 'theme') {
          await prefs.remove(key);
        }
      }
      
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Cache cleared successfully'),
            backgroundColor: Colors.green,
              ),
            );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error clearing cache: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
    );
  }
}
  }
}

// API Keys Tile
class _ApiKeysTile extends StatelessWidget {
  const _ApiKeysTile();

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.vpn_key),
      title: const Text('API Keys'),
      subtitle: const Text('Manage your API keys for integrations'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => const ApiKeysScreen(),
          ),
        );
      },
    );
  }
}

// GDPR Tile
class _GdprTile extends ConsumerWidget {
  const _GdprTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListTile(
      leading: const Icon(Icons.privacy_tip, color: Colors.orange),
      title: const Text('Data & Privacy', style: TextStyle(color: Colors.orange)),
      subtitle: const Text('Export or delete your data'),
      trailing: const Icon(Icons.chevron_right, color: Colors.orange),
      onTap: () => _showGdprDialog(context, ref),
    );
  }

  void _showGdprDialog(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.privacy_tip, color: Colors.orange),
            SizedBox(width: 8),
            Text('Data & Privacy'),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'You can export all your data or permanently delete your account and all associated data.',
              ),
              const SizedBox(height: 24),
              // Export button - prominent
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () {
                    Navigator.pop(dialogContext);
                    _exportData(context, ref);
                  },
                  icon: const Icon(Icons.download),
                  label: const Text('Export Data'),
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              const Divider(),
              const SizedBox(height: 12),
              // Delete account section - small, less prominent
              Center(
                child: Column(
                  children: [
                    Text(
                      'Want to delete your account?',
                      style: TextStyle(
                        fontSize: 13,
                        color: Colors.grey[600],
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: () {
                        Navigator.pop(dialogContext);
                        _showDeleteConfirmation(context, ref);
                      },
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.red[700],
                        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                        minimumSize: const Size(0, 40),
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.delete_outline, size: 18),
                          SizedBox(width: 6),
                          Text('Delete Account', style: TextStyle(fontSize: 13)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Future<void> _exportData(BuildContext context, WidgetRef ref) async {
    // Show loading dialog
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Text('Exporting data...'),
          ],
        ),
      ),
    );

    try {
      final apiClient = ref.read(apiClientProvider);
      // Correct path: /gdpr/export (base URL already includes /api/v1)
      final response = await apiClient.get('/gdpr/export');
      
      // Convert to JSON string for sharing
      final jsonString = jsonEncode(response.data);
      
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        final shareService = ref.read(shareServiceProvider);
        await shareService.shareText(
          text: jsonString,
          context: context,
          subject: 'InvoiceMe Data Export',
        );
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Row(
              children: [
                Icon(Icons.check_circle, color: Colors.white),
                SizedBox(width: 12),
                Text('Data exported successfully'),
              ],
            ),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 3),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        String errorMsg = 'Error exporting data';
        if (e is DioException) {
          if (e.response?.statusCode == 401) {
            errorMsg = 'Authentication failed. Please log in again.';
          } else if (e.type == DioExceptionType.connectionError) {
            errorMsg = 'Network error. Please check your connection.';
          } else {
            errorMsg = 'Error: ${e.message ?? e.toString()}';
          }
        } else {
          errorMsg = 'Error: ${e.toString()}';
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(child: Text(errorMsg)),
              ],
            ),
            backgroundColor: Colors.red,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    }
  }

  void _showDeleteConfirmation(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: Row(
          children: [
            Icon(Icons.warning, color: Colors.red[700], size: 28),
            const SizedBox(width: 12),
            const Expanded(
              child: Text(
                'Delete Account',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.red[50],
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: Colors.red[200]!),
                ),
                child: Row(
                  children: [
                    Icon(Icons.error_outline, color: Colors.red[700], size: 20),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        'This action cannot be undone!',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: Colors.red,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'This will permanently delete your account and ALL associated data including:',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              _buildWarningItem('All invoices and estimates'),
              _buildWarningItem('All clients and contacts'),
              _buildWarningItem('All payment records'),
              _buildWarningItem('All settings and preferences'),
              _buildWarningItem('All uploaded files and attachments'),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.orange[50],
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(Icons.info_outline, color: Colors.orange[700], size: 20),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        'We recommend exporting your data before deleting your account.',
                        style: TextStyle(fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel', style: TextStyle(fontSize: 16)),
          ),
          const SizedBox(width: 8),
          // Smaller, less prominent delete button
          OutlinedButton(
            onPressed: () {
              Navigator.pop(context);
              _showFinalDeleteConfirmation(context, ref);
            },
            style: OutlinedButton.styleFrom(
              foregroundColor: Colors.red[700],
              side: BorderSide(color: Colors.red[300]!),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              minimumSize: const Size(0, 40),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.delete_outline, size: 18),
                SizedBox(width: 6),
                Text('Continue to Delete', style: TextStyle(fontSize: 14)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWarningItem(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Icon(Icons.remove, color: Colors.red[400], size: 16),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 14))),
        ],
      ),
    );
  }

  void _showFinalDeleteConfirmation(BuildContext context, WidgetRef ref) {
    final confirmController = TextEditingController();
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: Row(
            children: [
              Icon(Icons.dangerous, color: Colors.red[700], size: 28),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'Final Confirmation',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red[50],
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: Colors.red[200]!),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.warning_amber_rounded, color: Colors.red, size: 24),
                      SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'You are about to permanently delete your account. This action is IRREVERSIBLE.',
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: Colors.red,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                const Text(
                  'To confirm, please type "DELETE" in the box below:',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: confirmController,
                  decoration: InputDecoration(
                    labelText: 'Type DELETE to confirm',
                    border: const OutlineInputBorder(),
                    prefixIcon: const Icon(Icons.edit),
                    errorText: confirmController.text.isNotEmpty &&
                            confirmController.text != 'DELETE'
                        ? 'Must type exactly "DELETE"'
                        : null,
                  ),
                  onChanged: (value) => setState(() {}),
                  // autofocus: true, // Disabled to prevent Flutter web focus errors
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel', style: TextStyle(fontSize: 16)),
            ),
            const SizedBox(width: 8),
            // Only enable if user typed DELETE exactly
            OutlinedButton(
              onPressed: confirmController.text == 'DELETE'
                  ? () {
                      Navigator.pop(context);
                      _deleteAccount(context, ref);
                    }
                  : null,
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.red[700],
                side: BorderSide(color: Colors.red[300]!),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                minimumSize: const Size(0, 40),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.delete_forever, size: 18),
                  SizedBox(width: 6),
                  Text('Delete Forever', style: TextStyle(fontSize: 14)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _deleteAccount(BuildContext context, WidgetRef ref) async {
    // Show loading dialog
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Text('Deleting account...'),
          ],
        ),
      ),
    );

    try {
      final apiClient = ref.read(apiClientProvider);
      final authService = ref.read(authServiceProvider);
      
      // Correct path: /gdpr/delete (base URL already includes /api/v1)
      await apiClient.delete('/gdpr/delete');
      
      // Logout after deletion
      await authService.logout();
      
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => const LoginScreen()),
          (route) => false,
        );
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Row(
              children: [
                Icon(Icons.check_circle, color: Colors.white),
                SizedBox(width: 12),
                Text('Account and all data deleted successfully'),
              ],
            ),
            backgroundColor: Colors.green,
            duration: Duration(seconds: 3),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        Navigator.pop(context); // Close loading dialog
        String errorMsg = 'Error deleting account';
        if (e is DioException) {
          if (e.response?.statusCode == 401) {
            errorMsg = 'Authentication failed. Please log in again.';
          } else if (e.type == DioExceptionType.connectionError) {
            errorMsg = 'Network error. Please check your connection.';
          } else if (e.response?.statusCode == 403) {
            errorMsg = 'Permission denied. Cannot delete account.';
          } else {
            errorMsg = 'Error: ${e.message ?? e.toString()}';
          }
        } else {
          errorMsg = 'Error: ${e.toString()}';
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(child: Text(errorMsg)),
              ],
            ),
            backgroundColor: Colors.red,
            duration: const Duration(seconds: 4),
          ),
        );
      }
    }
  }
}

// Feedback Tile
class _FeedbackTile extends StatelessWidget {
  const _FeedbackTile();

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.feedback_outlined),
      title: const Text('Submit Feedback'),
      subtitle: const Text('Help us improve the app'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => const FeedbackScreen(),
          ),
        );
      },
    );
  }
}

// About Tile
class _AboutTile extends StatelessWidget {
  final PackageInfo? packageInfo;

  const _AboutTile({this.packageInfo});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: const Icon(Icons.info_outline),
      title: const Text('About'),
      subtitle: Text('Version ${packageInfo?.version ?? '1.0.0'} (Build ${packageInfo?.buildNumber ?? '1'})'),
      trailing: const Icon(Icons.chevron_right),
      onTap: () => _showAboutDialog(context),
    );
  }

  void _showAboutDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.receipt_long, color: Color(0xFF4a90e2)),
            SizedBox(width: 8),
            Text('InvoiceMe'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
              'Version ${packageInfo?.version ?? '1.0.0'}',
              style: const TextStyle(fontWeight: FontWeight.bold),
          ),
            if (packageInfo != null) ...[
          Text(
                'Build ${packageInfo!.buildNumber}',
                style: TextStyle(fontSize: 12, color: Colors.grey[600]),
          ),
              const SizedBox(height: 4),
          Text(
                'Package: ${packageInfo!.packageName}',
                style: TextStyle(fontSize: 12, color: Colors.grey[600]),
              ),
            ],
            const SizedBox(height: 16),
            const Text(
            'Professional invoicing made simple',
              style: TextStyle(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            const Text(
              'InvoiceMe helps you create, manage, and track invoices effortlessly.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                Consumer(
                  builder: (context, ref, _) {
                    return TextButton.icon(
                      onPressed: () async {
                        final shareService = ref.read(shareServiceProvider);
                        await shareService.shareText(
                          text: 'Check out InvoiceMe - Professional invoicing made simple!',
                          context: context,
                          subject: 'InvoiceMe App',
                        );
                      },
                      icon: const Icon(Icons.share),
                      label: const Text('Share'),
                    );
                  },
                ),
                TextButton.icon(
                  onPressed: () async {
                    final info = packageInfo != null
                        ? 'InvoiceMe\nVersion: ${packageInfo!.version}\nBuild: ${packageInfo!.buildNumber}\nPackage: ${packageInfo!.packageName}'
                        : 'InvoiceMe v1.0.0';
                    try {
                      await Clipboard.setData(ClipboardData(text: info));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Version info copied')),
                        );
                      }
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Unable to copy. Please select and copy manually.'),
                            backgroundColor: Colors.orange,
                          ),
                        );
                      }
                    }
                  },
                  icon: const Icon(Icons.copy),
                  label: const Text('Copy Info'),
                ),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}

// Logout Tile
class _LogoutTile extends ConsumerWidget {
  const _LogoutTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authService = ref.read(authServiceProvider);

    return ListTile(
      leading: const Icon(Icons.logout, color: Colors.red),
      title: const Text('Logout', style: TextStyle(color: Colors.red)),
      subtitle: const Text('Sign out of your account'),
      trailing: const Icon(Icons.chevron_right, color: Colors.red),
      onTap: () {
        showDialog(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Logout'),
            content: const Text('Are you sure you want to logout?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: () async {
                  Navigator.pop(context);
                  await authService.logout();
                  if (context.mounted) {
                    Navigator.of(context).pushAndRemoveUntil(
                      MaterialPageRoute(builder: (_) => const LoginScreen()),
                      (route) => false,
                    );
                  }
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.red,
                  foregroundColor: Colors.white,
                ),
                child: const Text('Logout'),
              ),
            ],
          ),
        );
      },
    );
  }
}
