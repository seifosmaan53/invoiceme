import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../core/providers/providers.dart';
import '../core/widgets/copyable_error.dart';
import '../widgets/empty_state.dart';
import '../widgets/loading_skeleton.dart';
import '../models/api_key.dart';
import 'create_api_key_screen.dart';
import 'api_key_usage_screen.dart';

class ApiKeysScreen extends ConsumerStatefulWidget {
  const ApiKeysScreen({super.key});

  @override
  ConsumerState<ApiKeysScreen> createState() => _ApiKeysScreenState();
}

class _ApiKeysScreenState extends ConsumerState<ApiKeysScreen> {
  List<ApiKey> _apiKeys = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadApiKeys();
  }

  Future<void> _loadApiKeys({bool refresh = false}) async {
    if (!refresh) setState(() => _isLoading = true);

    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/api-keys');

      setState(() {
        _apiKeys = (response.data as List)
            .map((json) => ApiKey.fromJson(json))
            .toList();
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading API keys: $e');
      }
    }
  }

  Future<void> _revokeKey(ApiKey apiKey) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Revoke API Key'),
        content: Text('Are you sure you want to revoke "${apiKey.name}"? This action cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Revoke'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final apiClient = ref.read(apiClientProvider);
      await apiClient.delete('/api-keys/${apiKey.id}');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('API key revoked')),
        );
        _loadApiKeys(refresh: true);
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error revoking key: $e');
      }
    }
  }

  void _showKeyDialog(ApiKey apiKey) {
    if (apiKey.key == null) return;

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Your API Key'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Save this key now! You won\'t be able to see it again.',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 16),
            SelectableText(
              apiKey.key!,
              style: const TextStyle(fontFamily: 'monospace'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () async {
              try {
                await Clipboard.setData(ClipboardData(text: apiKey.key!));
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Key copied to clipboard')),
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
            child: const Text('Copy'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('API Keys'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => _loadApiKeys(refresh: true),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final result = await Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const CreateApiKeyScreen(),
            ),
          );
          if (result != null && result is ApiKey) {
            _loadApiKeys(refresh: true);
            _showKeyDialog(result);
          }
        },
        child: const Icon(Icons.add),
      ),
      body: _isLoading
          ? ListView.builder(
              itemCount: 3,
              itemBuilder: (context, index) => const ListItemSkeleton(),
            )
          : _apiKeys.isEmpty
              ? const EmptyState(
                  icon: Icons.vpn_key,
                  title: 'No API Keys',
                  subtitle: 'Generate an API key to access your data programmatically',
                )
              : RefreshIndicator(
                  onRefresh: () => _loadApiKeys(refresh: true),
                  child: ListView.builder(
                    itemCount: _apiKeys.length,
                    itemBuilder: (context, index) {
                      final apiKey = _apiKeys[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: ListTile(
                          title: Text(apiKey.name),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (apiKey.lastUsedAt != null)
                                Text(
                                  'Last used: ${DateFormat('MMM d, y').format(apiKey.lastUsedAt!)}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                )
                              else
                                Text(
                                  'Never used',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              if (apiKey.expiresAt != null)
                                Text(
                                  'Expires: ${DateFormat('MMM d, y').format(apiKey.expiresAt!)}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              if (apiKey.permissions.isNotEmpty)
                                Text(
                                  'Permissions: ${apiKey.permissions.join(', ')}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                            ],
                          ),
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Chip(
                                label: Text(apiKey.isActive ? 'Active' : 'Revoked'),
                                backgroundColor: apiKey.isActive ? Colors.green : Colors.red,
                                labelStyle: const TextStyle(color: Colors.white, fontSize: 12),
                              ),
                              PopupMenuButton<String>(
                                onSelected: (value) {
                                  if (value == 'view_usage') {
                                    Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) => ApiKeyUsageScreen(apiKey: apiKey),
                                      ),
                                    );
                                  } else if (value == 'revoke') {
                                    _revokeKey(apiKey);
                                  }
                                },
                                itemBuilder: (context) => [
                                  const PopupMenuItem<String>(
                                    value: 'view_usage',
                                    child: Row(
                                      children: [
                                        Icon(Icons.analytics, size: 20),
                                        SizedBox(width: 8),
                                        Text('View Usage'),
                                      ],
                                    ),
                                  ),
                                  const PopupMenuDivider(),
                                  const PopupMenuItem<String>(
                                    value: 'revoke',
                                    child: Row(
                                      children: [
                                        Icon(Icons.delete, size: 20, color: Colors.red),
                                        SizedBox(width: 8),
                                        Text('Revoke', style: TextStyle(color: Colors.red)),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                          onTap: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => ApiKeyUsageScreen(apiKey: apiKey),
                              ),
                            );
                          },
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}

