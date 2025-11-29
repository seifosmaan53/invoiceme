import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../core/providers/providers.dart';
import '../core/widgets/copyable_error.dart';
import '../widgets/empty_state.dart';
import '../widgets/loading_skeleton.dart';
import '../models/recurring_invoice.dart';
import 'create_recurring_invoice_screen.dart';

class RecurringInvoicesScreen extends ConsumerStatefulWidget {
  const RecurringInvoicesScreen({super.key});

  @override
  ConsumerState<RecurringInvoicesScreen> createState() => _RecurringInvoicesScreenState();
}

class _RecurringInvoicesScreenState extends ConsumerState<RecurringInvoicesScreen> {
  List<RecurringInvoice> _recurring = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadRecurring();
  }

  Future<void> _loadRecurring({bool refresh = false}) async {
    if (!refresh) setState(() => _isLoading = true);

    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/recurring-invoices');

      setState(() {
        _recurring = (response.data as List)
            .map((json) => RecurringInvoice.fromJson(json))
            .toList();
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading recurring invoices: $e');
      }
    }
  }

  String _formatFrequency(RecurrenceFrequency frequency, int interval) {
    final freq = frequency.name;
    if (interval == 1) {
      return freq.substring(0, 1).toUpperCase() + freq.substring(1);
    }
    return 'Every $interval ${freq}s';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Recurring Invoices'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => _loadRecurring(refresh: true),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final result = await Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const CreateRecurringInvoiceScreen(),
            ),
          );
          if (result == true) {
            _loadRecurring(refresh: true);
          }
        },
        child: const Icon(Icons.add),
      ),
      body: _isLoading
          ? ListView.builder(
              itemCount: 3,
              itemBuilder: (context, index) => const ListItemSkeleton(),
            )
          : _recurring.isEmpty
              ? const EmptyState(
                  icon: Icons.repeat,
                  title: 'No Recurring Invoices',
                  subtitle: 'Create recurring invoices to automate your billing!',
                )
              : RefreshIndicator(
                  onRefresh: () => _loadRecurring(refresh: true),
                  child: ListView.builder(
                    itemCount: _recurring.length,
                    itemBuilder: (context, index) {
                      final recurring = _recurring[index];
                      final isOverdue = recurring.nextRunDate.isBefore(DateTime.now()) && recurring.isActive;
                      
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: ListTile(
                          title: Row(
                            children: [
                              Expanded(child: Text(recurring.name)),
                              const SizedBox(width: 8),
                              Chip(
                                label: Text(
                                  recurring.isActive ? 'Active' : 'Paused',
                                  style: const TextStyle(fontSize: 11, color: Colors.white),
                                ),
                                backgroundColor: recurring.isActive ? Colors.green : Colors.grey,
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              ),
                            ],
                          ),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  Icon(
                                    Icons.repeat,
                                    size: 14,
                                    color: Theme.of(context).colorScheme.primary,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    _formatFrequency(recurring.frequency, recurring.interval),
                                    style: Theme.of(context).textTheme.bodyMedium,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Container(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: isOverdue
                                      ? Colors.orange.withOpacity(0.1)
                                      : Theme.of(context).colorScheme.primaryContainer.withOpacity(0.3),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: isOverdue
                                        ? Colors.orange
                                        : Theme.of(context).colorScheme.primary.withOpacity(0.3),
                                    width: 1,
                                  ),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        Icon(
                                          Icons.schedule,
                                          size: 14,
                                          color: isOverdue
                                              ? Colors.orange
                                              : Theme.of(context).colorScheme.primary,
                                        ),
                                        const SizedBox(width: 4),
                                        Text(
                                          'Next run: ${DateFormat('MMM d, y • hh:mm a').format(recurring.nextRunDate)}',
                                          style: TextStyle(
                                            fontSize: 12,
                                            fontWeight: FontWeight.w500,
                                            color: isOverdue
                                                ? Colors.orange[700]
                                                : Theme.of(context).colorScheme.onPrimaryContainer,
                                          ),
                                        ),
                                        if (isOverdue) ...[
                                          const SizedBox(width: 4),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: Colors.orange,
                                              borderRadius: BorderRadius.circular(4),
                                            ),
                                            child: const Text(
                                              'OVERDUE',
                                              style: TextStyle(
                                                fontSize: 9,
                                                color: Colors.white,
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                    if (recurring.invoicesGenerated > 0) ...[
                                      const SizedBox(height: 4),
                                      Row(
                                        children: [
                                          Icon(
                                            Icons.receipt,
                                            size: 14,
                                            color: Theme.of(context).colorScheme.secondary,
                                          ),
                                          const SizedBox(width: 4),
                                          Text(
                                            '${recurring.invoicesGenerated} invoice${recurring.invoicesGenerated == 1 ? '' : 's'} generated',
                                            style: TextStyle(
                                              fontSize: 11,
                                              color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                          trailing: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Switch(
                                value: recurring.isActive,
                                onChanged: (value) async {
                                  // Toggle active status
                                  try {
                                    final apiClient = ref.read(apiClientProvider);
                                    await apiClient.patch(
                                      '/recurring-invoices/${recurring.id}',
                                      data: {'isActive': value},
                                    );
                                    _loadRecurring(refresh: true);
                                  } catch (e) {
                                    if (mounted) {
                                      CopyableErrorSnackBar.show(context, 'Error updating: $e');
                                    }
                                  }
                                },
                              ),
                              PopupMenuButton(
                                itemBuilder: (context) => [
                                  PopupMenuItem(
                                    child: const Row(
                                      children: [
                                        Icon(Icons.edit, size: 20),
                                        SizedBox(width: 8),
                                        Text('Edit'),
                                      ],
                                    ),
                                    onTap: () async {
                                      final result = await Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) => CreateRecurringInvoiceScreen(
                                            recurring: recurring,
                                          ),
                                        ),
                                      );
                                      if (result == true) {
                                        _loadRecurring(refresh: true);
                                      }
                                    },
                                  ),
                                ],
                              ),
                            ],
                          ),
                          onTap: () async {
                            final result = await Navigator.push(
                              context,
                              MaterialPageRoute(
                                builder: (_) => CreateRecurringInvoiceScreen(
                                  recurring: recurring,
                                ),
                              ),
                            );
                            if (result == true) {
                              _loadRecurring(refresh: true);
                            }
                          },
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}

