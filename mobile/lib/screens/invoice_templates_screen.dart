import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/providers/providers.dart';
import '../core/widgets/copyable_error.dart';
import '../widgets/empty_state.dart';
import '../widgets/loading_skeleton.dart';
import '../models/invoice_template.dart';
import 'create_invoice_template_screen.dart';
import 'create_invoice_screen.dart';

class InvoiceTemplatesScreen extends ConsumerStatefulWidget {
  const InvoiceTemplatesScreen({super.key});

  @override
  ConsumerState<InvoiceTemplatesScreen> createState() => _InvoiceTemplatesScreenState();
}

class _InvoiceTemplatesScreenState extends ConsumerState<InvoiceTemplatesScreen> {
  List<InvoiceTemplate> _templates = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadTemplates();
  }

  Future<void> _loadTemplates({bool refresh = false}) async {
    if (!refresh) setState(() => _isLoading = true);

    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/invoice-templates');

      setState(() {
        _templates = (response.data as List)
            .map((json) => InvoiceTemplate.fromJson(json))
            .toList();
        _isLoading = false;
      });
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading templates: $e');
      }
    }
  }

  Future<void> _deleteTemplate(InvoiceTemplate template) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Template'),
        content: Text('Are you sure you want to delete "${template.name}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final apiClient = ref.read(apiClientProvider);
      await apiClient.delete('/invoice-templates/${template.id}');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Template deleted')),
        );
        _loadTemplates(refresh: true);
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error deleting template: $e');
      }
    }
  }

  Future<void> _createInvoiceFromTemplate(InvoiceTemplate template) async {
    // Navigate to create invoice screen with template pre-filled
    final result = await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => CreateInvoiceScreen(template: template),
      ),
    );

    if (result == true && mounted) {
      Navigator.pop(context, true); // Return to invoices list
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Invoice Templates'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => _loadTemplates(refresh: true),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () async {
          final result = await Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const CreateInvoiceTemplateScreen(),
            ),
          );
          if (result == true) {
            _loadTemplates(refresh: true);
          }
        },
        child: const Icon(Icons.add),
      ),
      body: _isLoading
          ? ListView.builder(
              itemCount: 3,
              itemBuilder: (context, index) => const ListItemSkeleton(),
            )
          : _templates.isEmpty
              ? const EmptyState(
                  icon: Icons.description,
                  title: 'No Templates',
                  subtitle: 'Create your first invoice template to save time!',
                )
              : RefreshIndicator(
                  onRefresh: () => _loadTemplates(refresh: true),
                  child: ListView.builder(
                    itemCount: _templates.length,
                    itemBuilder: (context, index) {
                      final template = _templates[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: ListTile(
                          title: Text(template.name),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (template.description != null)
                                Text(template.description!),
                              const SizedBox(height: 4),
                              Text(
                                '${template.items.length} items • ${template.currency} • ${template.defaultDueDays} days',
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                          trailing: PopupMenuButton(
                            itemBuilder: (context) => [
                              PopupMenuItem(
                                child: const Row(
                                  children: [
                                    Icon(Icons.add, size: 20),
                                    SizedBox(width: 8),
                                    Text('Create Invoice'),
                                  ],
                                ),
                                onTap: () => _createInvoiceFromTemplate(template),
                              ),
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
                                      builder: (_) => CreateInvoiceTemplateScreen(template: template),
                                    ),
                                  );
                                  if (result == true) {
                                    _loadTemplates(refresh: true);
                                  }
                                },
                              ),
                              PopupMenuItem(
                                child: const Row(
                                  children: [
                                    Icon(Icons.delete, size: 20, color: Colors.red),
                                    SizedBox(width: 8),
                                    Text('Delete', style: TextStyle(color: Colors.red)),
                                  ],
                                ),
                                onTap: () => _deleteTemplate(template),
                              ),
                            ],
                          ),
                          onTap: () => _createInvoiceFromTemplate(template),
                        ),
                      );
                    },
                  ),
                ),
    );
  }
}

