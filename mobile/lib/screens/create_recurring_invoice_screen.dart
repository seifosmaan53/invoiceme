import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../core/providers/providers.dart';
import '../core/utils/form_validators.dart';
import '../core/widgets/copyable_error.dart';
import '../models/recurring_invoice.dart';
import '../models/client.dart';

class CreateRecurringInvoiceScreen extends ConsumerStatefulWidget {
  final RecurringInvoice? recurring;

  const CreateRecurringInvoiceScreen({super.key, this.recurring});

  @override
  ConsumerState<CreateRecurringInvoiceScreen> createState() => _CreateRecurringInvoiceScreenState();
}

class _CreateRecurringInvoiceScreenState extends ConsumerState<CreateRecurringInvoiceScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _notesController = TextEditingController();
  final List<_RecurringItemInput> _items = [];
  Client? _selectedClient;
  RecurrenceFrequency _frequency = RecurrenceFrequency.monthly;
  int _interval = 1;
  DateTime _startDate = DateTime.now();
  DateTime? _endDate;
  String _currency = 'USD';
  bool _isActive = true;
  bool _isSubmitting = false;
  List<Client> _clients = [];
  bool _isLoadingClients = true;

  @override
  void initState() {
    super.initState();
    _loadClients();
    if (widget.recurring != null) {
      _nameController.text = widget.recurring!.name;
      _notesController.text = widget.recurring!.notes ?? '';
      _frequency = widget.recurring!.frequency;
      _interval = widget.recurring!.interval;
      _startDate = widget.recurring!.startDate;
      _endDate = widget.recurring!.endDate;
      _currency = widget.recurring!.currency;
      _isActive = widget.recurring!.isActive;
      _items.addAll(
        widget.recurring!.items.map((item) => _RecurringItemInput(
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        )),
      );
    } else {
      _items.add(_RecurringItemInput());
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
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
        if (widget.recurring != null && _clients.isNotEmpty) {
          _selectedClient = _clients.firstWhere(
            (c) => c.id == widget.recurring!.clientId,
            orElse: () => _clients.first,
          );
        } else if (_clients.isNotEmpty) {
          _selectedClient = _clients.first;
        }
        _isLoadingClients = false;
      });
    } catch (e) {
      setState(() => _isLoadingClients = false);
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error loading clients: $e');
      }
    }
  }

  void _addItem() {
    setState(() {
      _items.add(_RecurringItemInput());
    });
  }

  void _removeItem(int index) {
    if (index < 0 || index >= _items.length) return;
    setState(() {
      _items[index].dispose();
      _items.removeAt(index);
    });
  }

  DateTime _calculateNextRunDate() {
    final next = DateTime(_startDate.year, _startDate.month, _startDate.day);
    switch (_frequency) {
      case RecurrenceFrequency.daily:
        return next.add(Duration(days: _interval));
      case RecurrenceFrequency.weekly:
        return next.add(Duration(days: 7 * _interval));
      case RecurrenceFrequency.monthly:
        return DateTime(next.year, next.month + _interval, next.day);
      case RecurrenceFrequency.quarterly:
        return DateTime(next.year, next.month + (3 * _interval), next.day);
      case RecurrenceFrequency.yearly:
        return DateTime(next.year + _interval, next.month, next.day);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedClient == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a client')),
      );
      return;
    }

    setState(() => _isSubmitting = true);

    try {
      final apiClient = ref.read(apiClientProvider);
      final payload = {
        'name': _nameController.text.trim(),
        'clientId': _selectedClient!.id,
        'frequency': _frequency.name,
        'interval': _interval,
        'startDate': _startDate.toIso8601String().split('T')[0],
        'endDate': _endDate?.toIso8601String().split('T')[0],
        'nextRunDate': _calculateNextRunDate().toIso8601String().split('T')[0],
        'currency': _currency,
        'lineItemsJson': _items
            .where((item) => item.descriptionController.text.trim().isNotEmpty)
            .map((item) => {
                    'description': item.descriptionController.text.trim(),
                    'quantity': double.tryParse(item.quantityController.text) ?? 1.0,
                    'unitPrice': double.tryParse(item.unitPriceController.text) ?? 0.0,
                })
            .toList(),
        'notes': _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
        'isActive': _isActive,
      };

      if (widget.recurring != null) {
        await apiClient.patch('/recurring-invoices/${widget.recurring!.id}', data: payload);
      } else {
        await apiClient.post('/recurring-invoices', data: payload);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(widget.recurring != null
                ? 'Recurring invoice updated!'
                : 'Recurring invoice created!'),
          ),
        );
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error saving: $e');
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
        title: Text(widget.recurring != null ? 'Edit Recurring Invoice' : 'New Recurring Invoice'),
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
                    labelText: 'Name *',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) => FormValidators.required(value, fieldName: 'Name'),
                ),
                const SizedBox(height: 16),
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
                      : (value) => setState(() => _selectedClient = value),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<RecurrenceFrequency>(
                        value: _frequency,
                        decoration: const InputDecoration(
                          labelText: 'Frequency',
                          border: OutlineInputBorder(),
                        ),
                        items: RecurrenceFrequency.values.map((freq) {
                          return DropdownMenuItem(
                            value: freq,
                            child: Text(freq.name.substring(0, 1).toUpperCase() + freq.name.substring(1)),
                          );
                        }).toList(),
                        onChanged: (value) => setState(() => _frequency = value!),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: TextFormField(
                        initialValue: _interval.toString(),
                        decoration: const InputDecoration(
                          labelText: 'Interval',
                          border: OutlineInputBorder(),
                        ),
                        keyboardType: TextInputType.number,
                        onChanged: (value) {
                          _interval = int.tryParse(value) ?? 1;
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: InkWell(
                        onTap: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _startDate,
                            firstDate: DateTime.now(),
                            lastDate: DateTime(2100),
                          );
                          if (picked != null) {
                            setState(() => _startDate = picked);
                          }
                        },
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            labelText: 'Start Date *',
                            border: OutlineInputBorder(),
                          ),
                          child: Text(DateFormat('MMM d, y').format(_startDate)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: InkWell(
                        onTap: () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _endDate ?? DateTime.now().add(const Duration(days: 365)),
                            firstDate: _startDate,
                            lastDate: DateTime(2100),
                          );
                          if (picked != null) {
                            setState(() => _endDate = picked);
                          }
                        },
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            labelText: 'End Date (optional)',
                            border: OutlineInputBorder(),
                          ),
                          child: Text(_endDate != null
                              ? DateFormat('MMM d, y').format(_endDate!)
                              : 'No end date'),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                DropdownButtonFormField<String>(
                  value: _currency,
                  decoration: const InputDecoration(
                    labelText: 'Currency',
                    border: OutlineInputBorder(),
                  ),
                  items: const [
                    DropdownMenuItem(value: 'USD', child: Text('USD')),
                    DropdownMenuItem(value: 'EUR', child: Text('EUR')),
                    DropdownMenuItem(value: 'GBP', child: Text('GBP')),
                  ],
                  onChanged: (value) => setState(() => _currency = value!),
                ),
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Line Items', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    IconButton(
                      icon: const Icon(Icons.add),
                      onPressed: _addItem,
                      tooltip: 'Add Item',
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                ...List.generate(_items.length, (index) {
                  return _RecurringItemWidget(
                    item: _items[index],
                    onRemove: () => _removeItem(index),
                    canRemove: _items.length > 1,
                  );
                }),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _notesController,
                  decoration: const InputDecoration(
                    labelText: 'Notes',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 3,
                ),
                const SizedBox(height: 16),
                SwitchListTile(
                  title: const Text('Active'),
                  value: _isActive,
                  onChanged: (value) => setState(() => _isActive = value),
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
                        : Text(widget.recurring != null
                            ? 'Update Recurring Invoice'
                            : 'Create Recurring Invoice'),
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

class _RecurringItemInput {
  final TextEditingController descriptionController = TextEditingController();
  final TextEditingController quantityController = TextEditingController();
  final TextEditingController unitPriceController = TextEditingController();

  _RecurringItemInput({
    String? description,
    double? quantity,
    double? unitPrice,
  }) {
    if (description != null) descriptionController.text = description;
    if (quantity != null) quantityController.text = quantity.toString();
    if (unitPrice != null) unitPriceController.text = unitPrice.toString();
  }

  void dispose() {
    descriptionController.dispose();
    quantityController.dispose();
    unitPriceController.dispose();
  }
}

class _RecurringItemWidget extends StatelessWidget {
  final _RecurringItemInput item;
  final VoidCallback onRemove;
  final bool canRemove;

  const _RecurringItemWidget({
    required this.item,
    required this.onRemove,
    required this.canRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            TextFormField(
              controller: item.descriptionController,
              decoration: const InputDecoration(
                labelText: 'Description',
                border: OutlineInputBorder(),
              ),
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
                    initialValue: '1',
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextFormField(
                    controller: item.unitPriceController,
                    decoration: const InputDecoration(
                      labelText: 'Unit Price',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: TextInputType.number,
                  ),
                ),
                if (canRemove)
                  IconButton(
                    icon: const Icon(Icons.delete, color: Colors.red),
                    onPressed: onRemove,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

