// Flutter imports
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter/material.dart';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

// Local imports - Core
import '../core/providers/providers.dart';
import '../core/providers/refresh_provider.dart';
import '../core/utils/error_handler.dart';
import '../core/widgets/copyable_error.dart';

// Local imports - Models
import '../models/client.dart';
import '../models/invoice.dart';
import '../models/invoice_template.dart';

// Local imports - Screens
import 'invoice_preview_screen.dart';

// Local imports - Widgets
import '../widgets/field_error_widget.dart';

class CreateInvoiceScreen extends ConsumerStatefulWidget {
  final InvoiceTemplate? template;

  const CreateInvoiceScreen({super.key, this.template});

  @override
  ConsumerState<CreateInvoiceScreen> createState() => _CreateInvoiceScreenState();
}

class _CreateInvoiceScreenState extends ConsumerState<CreateInvoiceScreen> {
  final _formKey = GlobalKey<FormState>();
  Client? _selectedClient;
  InvoiceType _invoiceType = InvoiceType.invoice;
  DateTime _issueDate = DateTime.now();
  DateTime? _dueDate;
  String _currency = 'USD';
  final List<InvoiceItemInput> _items = [];
  final TextEditingController _notesController = TextEditingController();
  List<Client> _clients = [];
  bool _isLoadingClients = true;
  bool _isSubmitting = false;
  Map<String, String?> _fieldErrors = {}; // Field-level validation errors

  @override
  void initState() {
    super.initState();
    _loadClients();
    
    // If template provided, pre-fill from template
    if (widget.template != null) {
      _invoiceType = widget.template!.type == 'invoice' ? InvoiceType.invoice : InvoiceType.estimate;
      _currency = widget.template!.currency;
      _dueDate = DateTime.now().add(Duration(days: widget.template!.defaultDueDays));
      _notesController.text = widget.template!.notes ?? '';
      _items.clear();
      _items.addAll(
        widget.template!.items.map((item) {
          final input = InvoiceItemInput();
          input.descriptionController.text = item.description;
          input.quantityController.text = item.quantity.toString();
          input.unitPriceController.text = item.unitPrice.toString();
          return input;
        }),
      );
    } else {
      // Add one empty item by default
      _items.add(InvoiceItemInput());
    }
  }

  @override
  void dispose() {
    _notesController.dispose();
    for (var item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  Future<void> _loadClients() async {
    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/clients', queryParameters: {
        'page': 1,
        'limit': 100,
      });

      final data = response.data['data'] as List;
      setState(() {
        _clients = data.map((json) => Client.fromJson(json)).toList();
        _isLoadingClients = false;
      });
    } catch (e) {
      setState(() => _isLoadingClients = false);
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading clients: $e');
      }
    }
  }

  void _showPreview() {
    if (_selectedClient == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select a client first'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    final items = _items
        .where((item) => item.descriptionController.text.isNotEmpty)
        .map((item) {
          return {
            'description': item.descriptionController.text.trim(),
            'quantity': double.tryParse(item.quantityController.text) ?? 1,
            'unitPrice': double.tryParse(item.unitPriceController.text) ?? 0,
            'taxRate': double.tryParse(item.taxRateController.text) ?? 0,
            'discountRate': double.tryParse(item.discountRateController.text) ?? 0,
          };
        })
        .toList();

    if (items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please add at least one item'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (context) => InvoicePreviewScreen(
          client: _selectedClient,
          type: _invoiceType,
          issueDate: _issueDate,
          dueDate: _dueDate,
          currency: _currency,
          items: items,
          notes: _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
          status: InvoiceStatus.draft,
        ),
      ),
    );
  }

  Future<void> _selectDate(BuildContext context, bool isIssueDate) async {
    final picked = await showDatePicker(
      context: context,
      initialDate: isIssueDate ? _issueDate : (_dueDate ?? DateTime.now()),
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) {
      setState(() {
        if (isIssueDate) {
          _issueDate = picked;
        } else {
          _dueDate = picked;
        }
      });
    }
  }

  void _addItem() {
    setState(() {
      _items.add(InvoiceItemInput());
    });
  }

  void _duplicateItem(int index) {
    if (index < 0 || index >= _items.length) return;
    setState(() {
      final originalItem = _items[index];
      final newItem = InvoiceItemInput();
      // Copy all values from the original item
      newItem.descriptionController.text = originalItem.descriptionController.text;
      newItem.quantityController.text = originalItem.quantityController.text;
      newItem.unitPriceController.text = originalItem.unitPriceController.text;
      newItem.taxRateController.text = originalItem.taxRateController.text;
      newItem.discountRateController.text = originalItem.discountRateController.text;
      // Insert the duplicated item right after the original
      _items.insert(index + 1, newItem);
    });
  }

  void _removeItem(int index) {
    if (index < 0 || index >= _items.length) return;
    setState(() {
      _items[index].dispose();
      _items.removeAt(index);
    });
  }

  double _calculateTotals() {
    double total = 0;
    for (var item in _items) {
      final quantity = double.tryParse(item.quantityController.text) ?? 0;
      final unitPrice = double.tryParse(item.unitPriceController.text) ?? 0;
      final taxRate = double.tryParse(item.taxRateController.text) ?? 0;
      final discountRate = double.tryParse(item.discountRateController.text) ?? 0;

      double lineTotal = quantity * unitPrice;
      if (discountRate > 0) {
        lineTotal -= (lineTotal * discountRate) / 100;
      }
      if (taxRate > 0) {
        lineTotal += (lineTotal * taxRate) / 100;
      }
      total += lineTotal;
    }
    return total;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    if (_selectedClient == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a client')),
      );
      return;
    }

    if (_items.isEmpty || _items.every((item) => item.descriptionController.text.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please add at least one item with a description'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    // Validate items have required fields
    final invalidItems = _items.where((item) {
      if (item.descriptionController.text.isEmpty) return false; // Skip empty items
      final quantity = double.tryParse(item.quantityController.text);
      final unitPrice = double.tryParse(item.unitPriceController.text);
      return quantity == null || quantity <= 0 || unitPrice == null || unitPrice <= 0;
    }).toList();

    if (invalidItems.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please ensure all items have valid quantity (> 0) and unit price (> 0)'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    Map<String, dynamic> requestData = {}; // Declare outside try block for error logging

    try {
      final apiClient = ref.read(apiClientProvider);
      
      final items = _items
          .where((item) => item.descriptionController.text.isNotEmpty)
          .map((item) {
            final discountRate = double.tryParse(item.discountRateController.text) ?? 0;
            final taxRate = double.tryParse(item.taxRateController.text) ?? 0;
            final itemData = <String, dynamic>{
              'description': item.descriptionController.text.trim(),
              'quantity': double.tryParse(item.quantityController.text) ?? 1,
              'unitPrice': double.tryParse(item.unitPriceController.text) ?? 0,
            };
            // Always include taxRate and discountRate to ensure they're saved
            itemData['taxRate'] = taxRate;
            itemData['discountRate'] = discountRate;
            // Discount rate is included in item data
            return itemData;
          })
          .toList();

      // Ensure we have at least one valid item
      if (items.isEmpty) {
        throw Exception('At least one item is required');
      }

      requestData = {
        'clientId': _selectedClient!.id,
        'type': _invoiceType.name,
        'issueDate': DateFormat('yyyy-MM-dd').format(_issueDate),
        if (_dueDate != null) 'dueDate': DateFormat('yyyy-MM-dd').format(_dueDate!),
        'currency': _currency,
        'items': items,
        if (_notesController.text.isNotEmpty) 'notes': _notesController.text,
      };

      final response = await apiClient.post('/invoices', data: requestData);

      // Check if the request was successful
      if (response.statusCode == 201 || response.statusCode == 200) {
        // Trigger refresh for invoices and dashboard
        triggerRefresh(ref, RefreshType.invoices);
        triggerRefresh(ref, RefreshType.dashboard);
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Invoice created successfully!'),
              backgroundColor: Colors.green,
            ),
          );
          Navigator.of(context).pop(true); // Return true to indicate success
        }
      } else {
        throw Exception('Failed to create invoice: ${response.statusCode}');
      }
    } on DioException catch (e) {
      final apiError = e.toApiError();
      
      // Handle field-level validation errors
      if (apiError.hasFieldErrors) {
        setState(() {
          _fieldErrors = {};
          for (final fieldError in apiError.fieldErrors!) {
            // Map backend field names to form field names
            String formField = fieldError.field;
            if (formField == 'clientId') formField = 'client';
            if (formField == 'issueDate') formField = 'issueDate';
            if (formField == 'dueDate') formField = 'dueDate';
            if (formField.startsWith('items[')) {
              // Extract item index from field name like "items[0].description"
              final match = RegExp(r'items\[(\d+)\]\.(\w+)').firstMatch(formField);
              if (match != null) {
                final index = int.parse(match.group(1)!);
                final itemField = match.group(2)!;
                if (index < _items.length) {
                  // Store error in item
                  _items[index].error = fieldError.message;
                }
              }
            } else {
              _fieldErrors[formField] = fieldError.message;
            }
          }
        });
      }
      
      // Show user-friendly error message
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(apiError.getFriendlyMessage()),
            backgroundColor: Colors.red,
            duration: const Duration(seconds: 4),
          ),
        );
      }
      
      // Log full error for debugging
      debugPrint('API Error: ${apiError.errorCode} - ${apiError.allMessages}');
      if (apiError.hasFieldErrors) {
        debugPrint('Field errors: ${apiError.fieldErrors}');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error creating invoice: ${e.toString()}'),
            backgroundColor: Colors.red,
          ),
        );
      }
      debugPrint('Unexpected error: $e');
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
        title: const Text('Create Invoice'),
        actions: [
          IconButton(
            icon: const Icon(Icons.preview),
            tooltip: 'Preview Invoice',
            onPressed: _selectedClient == null || _items.isEmpty || _items.every((item) => item.descriptionController.text.trim().isEmpty)
                ? null
                : () => _showPreview(),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Client Selection
            DropdownButtonFormField<Client>(
              value: _selectedClient,
              decoration: const InputDecoration(
                labelText: 'Client *',
                border: OutlineInputBorder(),
              ),
              items: _clients.map((client) {
                return DropdownMenuItem(
                  value: client,
                  child: Text(client.name),
                );
              }).toList(),
              onChanged: _isLoadingClients
                  ? null
                  : (client) {
                      setState(() => _selectedClient = client);
                    },
              validator: (value) => value == null ? 'Please select a client' : null,
            ),
            const SizedBox(height: 16),

            // Invoice Type
            SegmentedButton<InvoiceType>(
              segments: const [
                ButtonSegment(value: InvoiceType.invoice, label: Text('Invoice')),
                ButtonSegment(value: InvoiceType.estimate, label: Text('Estimate')),
              ],
              selected: {_invoiceType},
              onSelectionChanged: (Set<InvoiceType> newSelection) {
                setState(() => _invoiceType = newSelection.first);
              },
            ),
            const SizedBox(height: 16),

            // Issue Date
            InkWell(
              onTap: () => _selectDate(context, true),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Issue Date *',
                  border: OutlineInputBorder(),
                ),
                child: Text(DateFormat('yyyy-MM-dd').format(_issueDate)),
              ),
            ),
            const SizedBox(height: 16),

            // Due Date
            InkWell(
              onTap: () => _selectDate(context, false),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Due Date (Optional)',
                  border: OutlineInputBorder(),
                ),
                child: Text(_dueDate != null ? DateFormat('yyyy-MM-dd').format(_dueDate!) : 'Select date'),
              ),
            ),
            const SizedBox(height: 16),

            // Currency
            DropdownButtonFormField<String>(
              value: _currency,
              decoration: const InputDecoration(
                labelText: 'Currency',
                border: OutlineInputBorder(),
              ),
              items: ['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((curr) {
                return DropdownMenuItem(value: curr, child: Text(curr));
              }).toList(),
              onChanged: (value) {
                setState(() => _currency = value!);
              },
            ),
            const SizedBox(height: 24),

            // Items Section
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Items', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                TextButton.icon(
                  onPressed: _addItem,
                  icon: const Icon(Icons.add),
                  label: const Text('Add Item'),
                ),
              ],
            ),
                  ...List.generate(_items.length, (index) {
                    return _InvoiceItemWidget(
                      item: _items[index],
                      onRemove: _items.length > 1 ? () => _removeItem(index) : null,
                      onDuplicate: () => _duplicateItem(index),
                    );
                  }),
            const SizedBox(height: 16),

            // Total Preview
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.3),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Total:', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  Text(
                    '$_currency ${_calculateTotals().toStringAsFixed(2)}',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            // Notes
            TextFormField(
              controller: _notesController,
              decoration: const InputDecoration(
                labelText: 'Notes (Optional)',
                border: OutlineInputBorder(),
              ),
              maxLines: 3,
            ),
            const SizedBox(height: 24),

            // Submit Button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isSubmitting ? null : _submit,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 15),
                  backgroundColor: const Color(0xFF4a90e2),
                  foregroundColor: Colors.white,
                ),
                child: _isSubmitting
                    ? const CircularProgressIndicator(color: Colors.white)
                    : const Text('Create Invoice', style: TextStyle(fontSize: 18)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class InvoiceItemInput {
  final TextEditingController descriptionController = TextEditingController();
  final TextEditingController quantityController = TextEditingController(text: '1');
  final TextEditingController unitPriceController = TextEditingController();
  final TextEditingController taxRateController = TextEditingController(text: '0');
  final TextEditingController discountRateController = TextEditingController(text: '0');
  String? error; // Field-level validation error

  void dispose() {
    descriptionController.dispose();
    quantityController.dispose();
    unitPriceController.dispose();
    taxRateController.dispose();
    discountRateController.dispose();
  }
}

class _InvoiceItemWidget extends StatelessWidget {
  final InvoiceItemInput item;
  final VoidCallback? onRemove;
  final VoidCallback? onDuplicate;

  const _InvoiceItemWidget({
    required this.item,
    this.onRemove,
    this.onDuplicate,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Item', style: TextStyle(fontWeight: FontWeight.bold)),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (onDuplicate != null)
                      IconButton(
                        icon: const Icon(Icons.copy, color: Colors.blue),
                        onPressed: onDuplicate,
                        tooltip: 'Duplicate this item',
                      ),
                    if (onRemove != null)
                      IconButton(
                        icon: const Icon(Icons.delete, color: Colors.red),
                        onPressed: onRemove,
                        tooltip: 'Remove this item',
                      ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 8),
              TextFormField(
                controller: item.descriptionController,
                decoration: InputDecoration(
                  labelText: 'Description *',
                  border: const OutlineInputBorder(),
                  errorText: item.error,
                ).withError(item.error),
                validator: (value) {
                  if (item.error != null) return null; // Let backend error show
                  return value?.isEmpty ?? true ? 'Required' : null;
                },
              ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: item.quantityController,
                    decoration: const InputDecoration(
                      labelText: 'Quantity',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                    validator: (value) {
                      if (value == null || value.isEmpty) return 'Required';
                      if (double.tryParse(value) == null) return 'Invalid number';
                      return null;
                    },
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    controller: item.unitPriceController,
                    decoration: const InputDecoration(
                      labelText: 'Unit Price *',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                    validator: (value) {
                      if (value == null || value.isEmpty) return 'Required';
                      if (double.tryParse(value) == null) return 'Invalid number';
                      return null;
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextFormField(
                    controller: item.taxRateController,
                    decoration: const InputDecoration(
                      labelText: 'Tax Rate (%)',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    controller: item.discountRateController,
                    decoration: const InputDecoration(
                      labelText: 'Discount (%)',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

