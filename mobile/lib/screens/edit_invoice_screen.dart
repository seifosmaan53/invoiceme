import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:dio/dio.dart';
import '../core/providers/providers.dart';
import '../core/providers/refresh_provider.dart';
import '../core/widgets/copyable_error.dart';
import '../models/client.dart';
import '../models/invoice.dart';
import '../models/invoice_item.dart';

class EditInvoiceScreen extends ConsumerStatefulWidget {
  final Invoice invoice;

  const EditInvoiceScreen({super.key, required this.invoice});

  @override
  ConsumerState<EditInvoiceScreen> createState() => _EditInvoiceScreenState();
}

class _EditInvoiceScreenState extends ConsumerState<EditInvoiceScreen> {
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
  Invoice? _fullInvoice;

  @override
  void initState() {
    super.initState();
    _loadFullInvoice();
    _loadClients();
  }

  Future<void> _loadFullInvoice() async {
    try {
      final apiClient = ref.read(apiClientProvider);
      final response = await apiClient.get('/invoices/${widget.invoice.id}');
      setState(() {
        _fullInvoice = Invoice.fromJson(response.data);
        _populateForm();
      });
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading invoice: $e');
      }
    }
  }

  void _populateForm() {
    if (_fullInvoice == null) return;
    
    final invoice = _fullInvoice!;
    _invoiceType = invoice.type;
    _issueDate = invoice.issueDate;
    _dueDate = invoice.dueDate;
    _currency = invoice.currency;
    _notesController.text = invoice.notes ?? '';
    
    // Populate items
    _items.clear();
    if (invoice.items != null && invoice.items!.isNotEmpty) {
      for (var item in invoice.items!) {
        _items.add(InvoiceItemInput(
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxRate: item.taxRate,
          discountRate: item.discountRate,
        ));
      }
    } else {
      _items.add(InvoiceItemInput());
    }
    
    // Set selected client if available
    if (invoice.client != null) {
      _selectedClient = invoice.client;
    }
    
    setState(() {});
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

      final data = response.data['data'] as List?;
      if (!mounted) return;
      setState(() {
        _clients = (data ?? []).map((json) => Client.fromJson(json)).toList();
        _isLoadingClients = false;
        // Try to match client if not already set
        if (_selectedClient == null && _fullInvoice != null && _clients.isNotEmpty) {
          _selectedClient = _clients.firstWhere(
            (c) => c.id == _fullInvoice!.clientId,
            orElse: () => _clients.first,
          );
        } else if (_selectedClient == null && _clients.isNotEmpty) {
          _selectedClient = _clients.first;
        }
      });
    } catch (e) {
      setState(() => _isLoadingClients = false);
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading clients: $e');
      }
    }
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

    final invalidItems = _items.where((item) {
      if (item.descriptionController.text.isEmpty) return false;
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

    try {
      final apiClient = ref.read(apiClientProvider);
      
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

      final requestData = {
        'clientId': _selectedClient!.id,
        'type': _invoiceType.name,
        'issueDate': DateFormat('yyyy-MM-dd').format(_issueDate),
        if (_dueDate != null) 'dueDate': DateFormat('yyyy-MM-dd').format(_dueDate!),
        'currency': _currency,
        'items': items,
        if (_notesController.text.isNotEmpty) 'notes': _notesController.text,
      };

      final response = await apiClient.patch('/invoices/${widget.invoice.id}', data: requestData);

      if (response.statusCode == 200 || response.statusCode == 201) {
        // Trigger refresh for invoices and dashboard
        triggerRefresh(ref, RefreshType.invoices);
        triggerRefresh(ref, RefreshType.dashboard);
        
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Invoice updated successfully!'),
              backgroundColor: Colors.green,
            ),
          );
          Navigator.of(context).pop(true);
        }
      }
    } catch (e) {
      if (mounted) {
        String errorMessage = 'Error updating invoice';
        if (e is DioException && e.response != null) {
          final responseData = e.response!.data;
          if (responseData is Map && responseData['message'] != null) {
            final message = responseData['message'];
            errorMessage = message is List ? message.join(', ') : message.toString();
          }
        }
        // Show copyable error
        CopyableErrorSnackBar.show(
          context,
          errorMessage,
          errorCode: e is DioException && e.response != null 
              ? 'HTTP ${e.response!.statusCode}' 
              : null,
        );
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
        title: const Text('Edit Invoice'),
      ),
      body: _fullInvoice == null
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
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
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
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
                  TextFormField(
                    controller: _notesController,
                    decoration: const InputDecoration(
                      labelText: 'Notes (Optional)',
                      border: OutlineInputBorder(),
                    ),
                    maxLines: 3,
                  ),
                  const SizedBox(height: 24),
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
                          : const Text('Update Invoice', style: TextStyle(fontSize: 18)),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

class InvoiceItemInput {
  final TextEditingController descriptionController;
  final TextEditingController quantityController;
  final TextEditingController unitPriceController;
  final TextEditingController taxRateController;
  final TextEditingController discountRateController;

  InvoiceItemInput({
    String? description,
    double? quantity,
    double? unitPrice,
    double? taxRate,
    double? discountRate,
  })  : descriptionController = TextEditingController(text: description),
        quantityController = TextEditingController(text: quantity?.toString() ?? '1'),
        unitPriceController = TextEditingController(text: unitPrice?.toString() ?? ''),
        taxRateController = TextEditingController(text: taxRate?.toString() ?? '0'),
        discountRateController = TextEditingController(text: discountRate?.toString() ?? '0');

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
              decoration: const InputDecoration(
                labelText: 'Description *',
                border: OutlineInputBorder(),
              ),
              validator: (value) => value?.isEmpty ?? true ? 'Required' : null,
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

