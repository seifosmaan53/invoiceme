import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/providers/providers.dart';
import '../core/utils/form_validators.dart';
import '../core/widgets/copyable_error.dart';
import '../models/invoice_template.dart';

class CreateInvoiceTemplateScreen extends ConsumerStatefulWidget {
  final InvoiceTemplate? template;

  const CreateInvoiceTemplateScreen({super.key, this.template});

  @override
  ConsumerState<CreateInvoiceTemplateScreen> createState() => _CreateInvoiceTemplateScreenState();
}

class _CreateInvoiceTemplateScreenState extends ConsumerState<CreateInvoiceTemplateScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _notesController = TextEditingController();
  final List<_TemplateItemInput> _items = [];
  String _type = 'invoice';
  String _currency = 'USD';
  int _defaultDueDays = 30;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    if (widget.template != null) {
      _nameController.text = widget.template!.name;
      _descriptionController.text = widget.template!.description ?? '';
      _notesController.text = widget.template!.notes ?? '';
      _type = widget.template!.type;
      _currency = widget.template!.currency;
      _defaultDueDays = widget.template!.defaultDueDays;
      _items.addAll(
        widget.template!.items.map((item) => _TemplateItemInput(
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        )),
      );
    } else {
      _items.add(_TemplateItemInput());
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _notesController.dispose();
    for (var item in _items) {
      item.dispose();
    }
    super.dispose();
  }

  void _addItem() {
    setState(() {
      _items.add(_TemplateItemInput());
    });
  }

  void _removeItem(int index) {
    setState(() {
      _items[index].dispose();
      _items.removeAt(index);
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    // Validate items
    for (var item in _items) {
      if (item.descriptionController.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Please fill in all item descriptions')),
        );
        return;
      }
    }

    setState(() => _isSubmitting = true);

    try {
      final apiClient = ref.read(apiClientProvider);
      final payload = {
        'name': _nameController.text.trim(),
        'description': _descriptionController.text.trim().isEmpty
            ? null
            : _descriptionController.text.trim(),
        'type': _type,
        'currency': _currency,
        'defaultDueDays': _defaultDueDays,
        'lineItemsJson': _items
            .where((item) => item.descriptionController.text.trim().isNotEmpty)
            .map((item) => {
                    'description': item.descriptionController.text.trim(),
                    'quantity': double.tryParse(item.quantityController.text) ?? 1.0,
                    'unitPrice': double.tryParse(item.unitPriceController.text) ?? 0.0,
                })
            .toList(),
        'notes': _notesController.text.trim().isEmpty ? null : _notesController.text.trim(),
      };

      if (widget.template != null) {
        await apiClient.patch('/invoice-templates/${widget.template!.id}', data: payload);
      } else {
        await apiClient.post('/invoice-templates', data: payload);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(widget.template != null
                ? 'Template updated successfully!'
                : 'Template created successfully!'),
          ),
        );
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        CopyableErrorSnackBar.show(context, 'Error saving template: $e');
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
        title: Text(widget.template != null ? 'Edit Template' : 'New Template'),
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
                    labelText: 'Template Name *',
                    border: OutlineInputBorder(),
                  ),
                  validator: (value) => FormValidators.required(value, fieldName: 'Template name'),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _descriptionController,
                  decoration: const InputDecoration(
                    labelText: 'Description',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 2,
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _type,
                        decoration: const InputDecoration(
                          labelText: 'Type',
                          border: OutlineInputBorder(),
                        ),
                        items: const [
                          DropdownMenuItem(value: 'invoice', child: Text('Invoice')),
                          DropdownMenuItem(value: 'estimate', child: Text('Estimate')),
                        ],
                        onChanged: (value) => setState(() => _type = value!),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: DropdownButtonFormField<String>(
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
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                TextFormField(
                  initialValue: _defaultDueDays.toString(),
                  decoration: const InputDecoration(
                    labelText: 'Default Due Days',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                  onChanged: (value) {
                    _defaultDueDays = int.tryParse(value) ?? 30;
                  },
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
                  return _TemplateItemWidget(
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
                        : Text(widget.template != null ? 'Update Template' : 'Create Template'),
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

class _TemplateItemInput {
  final TextEditingController descriptionController = TextEditingController();
  final TextEditingController quantityController = TextEditingController();
  final TextEditingController unitPriceController = TextEditingController();

  _TemplateItemInput({
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

class _TemplateItemWidget extends StatelessWidget {
  final _TemplateItemInput item;
  final VoidCallback onRemove;
  final bool canRemove;

  const _TemplateItemWidget({
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

