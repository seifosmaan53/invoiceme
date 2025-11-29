import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../core/providers/providers.dart';
import '../core/widgets/copyable_error.dart';
import '../models/api_key.dart';
import '../widgets/loading_skeleton.dart';

class ApiKeyUsageScreen extends ConsumerStatefulWidget {
  final ApiKey apiKey;

  const ApiKeyUsageScreen({super.key, required this.apiKey});

  @override
  ConsumerState<ApiKeyUsageScreen> createState() => _ApiKeyUsageScreenState();
}

class _ApiKeyUsageScreenState extends ConsumerState<ApiKeyUsageScreen> {
  Map<String, dynamic>? _stats;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    setState(() => _isLoading = true);

    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/api-keys/${widget.apiKey.id}/stats');

      setState(() {
        _stats = response.data as Map<String, dynamic>;
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading usage stats: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Usage: ${widget.apiKey.name}'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadStats,
          ),
        ],
      ),
      body: _isLoading
          ? ListView.builder(
              itemCount: 5,
              itemBuilder: (context, index) => const ListItemSkeleton(),
            )
          : RefreshIndicator(
              onRefresh: _loadStats,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // API Key Info Card
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'API Key Information',
                              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                            ),
                            const SizedBox(height: 16),
                            _buildInfoRow('Name', widget.apiKey.name),
                            _buildInfoRow(
                              'Status',
                              widget.apiKey.isActive ? 'Active' : 'Revoked',
                              valueColor: widget.apiKey.isActive ? Colors.green : Colors.red,
                            ),
                            if (widget.apiKey.expiresAt != null)
                              _buildInfoRow(
                                'Expires',
                                DateFormat('MMM d, y').format(widget.apiKey.expiresAt!),
                                valueColor: widget.apiKey.expiresAt!.isBefore(DateTime.now())
                                    ? Colors.red
                                    : null,
                              ),
                            if (widget.apiKey.lastUsedAt != null)
                              _buildInfoRow(
                                'Last Used',
                                DateFormat('MMM d, y HH:mm').format(widget.apiKey.lastUsedAt!),
                              )
                            else
                              _buildInfoRow('Last Used', 'Never'),
                            _buildInfoRow(
                              'Created',
                              DateFormat('MMM d, y').format(widget.apiKey.createdAt),
                            ),
                            if (widget.apiKey.permissions.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              const Divider(),
                              const SizedBox(height: 8),
                              Text(
                                'Permissions',
                                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                      fontWeight: FontWeight.bold,
                                    ),
                              ),
                              const SizedBox(height: 8),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: widget.apiKey.permissions.map((permission) {
                                  return Chip(
                                    label: Text(permission),
                                    backgroundColor: Colors.blue[100],
                                    labelStyle: const TextStyle(fontSize: 12),
                                  );
                                }).toList(),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),

                    // Usage Statistics Card
                    if (_stats != null) ...[
                      Card(
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Usage Statistics',
                                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                      fontWeight: FontWeight.bold,
                                    ),
                              ),
                              const SizedBox(height: 16),
                              _buildStatCard(
                                'Total Requests',
                                _stats!['totalRequests']?.toString() ?? '0',
                                Icons.api,
                                Colors.blue,
                              ),
                              const SizedBox(height: 12),
                              _buildStatCard(
                                'Last 24 Hours',
                                _stats!['requestsLast24h']?.toString() ?? '0',
                                Icons.access_time,
                                Colors.orange,
                              ),
                              const SizedBox(height: 12),
                              _buildStatCard(
                                'Last 7 Days',
                                _stats!['requestsLast7d']?.toString() ?? '0',
                                Icons.calendar_today,
                                Colors.green,
                              ),
                              const SizedBox(height: 12),
                              _buildStatCard(
                                'Last 30 Days',
                                _stats!['requestsLast30d']?.toString() ?? '0',
                                Icons.calendar_month,
                                Colors.purple,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],

                    // Rate Limit Info
                    const SizedBox(height: 16),
                    Card(
                      color: Colors.blue[50],
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Icon(Icons.info_outline, color: Colors.blue[700]),
                                const SizedBox(width: 8),
                                Text(
                                  'Rate Limits',
                                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                        fontWeight: FontWeight.bold,
                                        color: Colors.blue[700],
                                      ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'API keys are limited to 1,000 requests per minute. If you exceed this limit, requests will be rejected with a 429 status code.',
                              style: TextStyle(color: Colors.blue[900]),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildInfoRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w500,
                color: Colors.grey[600],
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: valueColor,
                fontWeight: valueColor != null ? FontWeight.bold : null,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatCard(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 32),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey[600],
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

