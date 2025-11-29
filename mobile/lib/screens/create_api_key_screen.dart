import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/providers/providers.dart';
import '../core/utils/form_validators.dart';
import '../core/widgets/copyable_error.dart';
import '../models/api_key.dart';

class CreateApiKeyScreen extends ConsumerStatefulWidget {
  const CreateApiKeyScreen({super.key});

  @override
  ConsumerState<CreateApiKeyScreen> createState() => _CreateApiKeyScreenState();
}

class _CreateApiKeyScreenState extends ConsumerState<CreateApiKeyScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final List<String> _selectedPermissions = [];
  DateTime? _expiresAt;
  bool _isSubmitting = false;

  final List<String> _availablePermissions = [
    // Invoice permissions
    'read:invoices',
    'write:invoices',
    'delete:invoices',
    // Client permissions
    'read:clients',
    'write:clients',
    'delete:clients',
    // Payment permissions
    'read:payments',
    'write:payments',
    'delete:payments',
    // Settings permissions
    'read:settings',
    'write:settings',
    // Dashboard permissions
    'read:dashboard',
    // Reports permissions
    'read:reports',
    // Full access (use with caution)
    '*',
  ];

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSubmitting = true);

    try {
      final apiClient = ref.read(apiClientProvider);
      final payload = {
        'name': _nameController.text.trim(),
        'permissions': _selectedPermissions,
        if (_expiresAt != null) 'expiresAt': _expiresAt!.toIso8601String().split('T')[0],
      };

      final response = await apiClient.post('/api-keys', data: payload);
      final apiKeyData = response.data['apiKey'] ?? response.data;
      final apiKey = ApiKey(
        id: apiKeyData['id'] as String,
        userId: apiKeyData['userId'] ?? apiKeyData['user_id'] as String,
        name: apiKeyData['name'] as String,
        permissions: (apiKeyData['permissionsJson'] ?? apiKeyData['permissions_json'] ?? [])
            .map((p) => p.toString())
            .toList()
            .cast<String>(),
        expiresAt: apiKeyData['expiresAt'] != null || apiKeyData['expires_at'] != null
            ? DateTime.parse(apiKeyData['expiresAt'] ?? apiKeyData['expires_at'])
            : null,
        isActive: apiKeyData['isActive'] ?? apiKeyData['is_active'] as bool? ?? true,
        lastUsedAt: apiKeyData['lastUsedAt'] != null || apiKeyData['last_used_at'] != null
            ? DateTime.parse(apiKeyData['lastUsedAt'] ?? apiKeyData['last_used_at'])
            : null,
        createdAt: DateTime.parse(apiKeyData['createdAt'] ?? apiKeyData['created_at']),
        updatedAt: DateTime.parse(apiKeyData['updatedAt'] ?? apiKeyData['updated_at']),
        key: response.data['key'] as String?,
      );

      if (mounted) {
        Navigator.pop(context, apiKey);
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error creating API key: $e');
      }
    } finally {
      if (mounted) {
        setState(() => _isSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Generate API Key'),
      ),
      body: AbsorbPointer(
        absorbing: _isSubmitting,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextFormField(
                  controller: _nameController,
                  decoration: const InputDecoration(
                    labelText: 'Key Name *',
                    border: OutlineInputBorder(),
                    hintText: 'e.g., Production API Key',
                  ),
                  validator: (value) => FormValidators.required(value, fieldName: 'Key name'),
                ),
                const SizedBox(height: 24),
                const Text(
                  'Permissions',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                ..._availablePermissions.map((permission) {
                  return CheckboxListTile(
                    title: Text(permission),
                    value: _selectedPermissions.contains(permission),
                    onChanged: (value) {
                      setState(() {
                        if (value == true) {
                          _selectedPermissions.add(permission);
                        } else {
                          _selectedPermissions.remove(permission);
                        }
                      });
                    },
                  );
                }),
                const SizedBox(height: 16),
                InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _expiresAt ?? DateTime.now().add(const Duration(days: 365)),
                      firstDate: DateTime.now(),
                      lastDate: DateTime(2100),
                    );
                    if (picked != null) {
                      setState(() => _expiresAt = picked);
                    }
                  },
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      labelText: 'Expiration Date (optional)',
                      border: OutlineInputBorder(),
                    ),
                    child: Text(_expiresAt != null
                        ? '${_expiresAt!.year}-${_expiresAt!.month.toString().padLeft(2, '0')}-${_expiresAt!.day.toString().padLeft(2, '0')}'
                        : 'No expiration'),
                  ),
                ),
                if (_expiresAt != null)
                  TextButton(
                    onPressed: () => setState(() => _expiresAt = null),
                    child: const Text('Remove expiration'),
                  ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _isSubmitting ? null : _submit,
                    child: _isSubmitting
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Generate API Key'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

