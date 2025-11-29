import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/invoice.dart';
import '../models/client.dart';

/// Preview screen for invoice before saving
class InvoicePreviewScreen extends StatelessWidget {
  final Invoice? invoice;
  final Client? client;
  final String? invoiceNumber;
  final DateTime? issueDate;
  final DateTime? dueDate;
  final String currency;
  final List<Map<String, dynamic>> items;
  final String? notes;
  final InvoiceType type;
  final InvoiceStatus status;

  const InvoicePreviewScreen({
    super.key,
    this.invoice,
    this.client,
    this.invoiceNumber,
    this.issueDate,
    this.dueDate,
    this.currency = 'USD',
    required this.items,
    this.notes,
    this.type = InvoiceType.invoice,
    this.status = InvoiceStatus.draft,
  });

  // Named constructor for creating from form data
  const InvoicePreviewScreen.fromForm({
    super.key,
    required this.client,
    required this.type,
    this.issueDate,
    this.dueDate,
    this.currency = 'USD',
    required this.items,
    this.notes,
    this.status = InvoiceStatus.draft,
  }) : invoice = null,
       invoiceNumber = null;

  @override
  Widget build(BuildContext context) {
    final dateFormat = DateFormat('MMM dd, yyyy');
    
    // Calculate totals
    double subtotal = 0;
    double taxTotal = 0;
    double discountTotal = 0;
    
    for (final item in items) {
      final quantity = (item['quantity'] as num?)?.toDouble() ?? 0;
      final unitPrice = (item['unitPrice'] as num?)?.toDouble() ?? 0;
      final taxRate = (item['taxRate'] as num?)?.toDouble() ?? 0;
      final discountRate = (item['discountRate'] as num?)?.toDouble() ?? 0;
      
      final lineSubtotal = quantity * unitPrice;
      final discount = lineSubtotal * (discountRate / 100);
      final afterDiscount = lineSubtotal - discount;
      final tax = afterDiscount * (taxRate / 100);
      
      subtotal += lineSubtotal;
      discountTotal += discount;
      taxTotal += tax;
    }
    
    final total = subtotal - discountTotal + taxTotal;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Invoice Preview'),
        actions: [
          IconButton(
            icon: const Icon(Icons.close),
            onPressed: () => Navigator.pop(context),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Card(
          elevation: 2,
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Header
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          type == InvoiceType.estimate ? 'ESTIMATE' : 'INVOICE',
                          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF4a90e2),
                              ),
                        ),
                        if (invoiceNumber != null) ...[
                          const SizedBox(height: 4),
                          Text(
                            'Number: $invoiceNumber',
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ],
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: _getStatusColor(status).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        status.name.toUpperCase(),
                        style: TextStyle(
                          color: _getStatusColor(status),
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                ),
                const Divider(height: 32),
                
                // Dates
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    if (issueDate != null)
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Issue Date',
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                                ),
                          ),
                          Text(
                            dateFormat.format(issueDate!),
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                        ],
                      ),
                    if (dueDate != null)
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            'Due Date',
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                                ),
                          ),
                          Text(
                            dateFormat.format(dueDate!),
                            style: Theme.of(context).textTheme.bodyLarge,
                          ),
                        ],
                      ),
                  ],
                ),
                const SizedBox(height: 24),
                
                // Client Info
                if (client != null) ...[
                  Text(
                    'Bill To:',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(client!.name),
                  if (client!.email != null) Text(client!.email!),
                  if (client!.phone != null) Text(client!.phone!),
                  const SizedBox(height: 24),
                ],
                
                // Items Table
                Text(
                  'Items:',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 8),
                Table(
                  border: TableBorder.all(
                    color: Theme.of(context).dividerColor,
                  ),
                  children: [
                    TableRow(
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surfaceVariant.withOpacity(0.3),
                      ),
                      children: [
                        _TableCell('Description', isHeader: true),
                        _TableCell('Qty', isHeader: true),
                        _TableCell('Price', isHeader: true),
                        if (items.any((item) {
                          final taxRate = (item['taxRate'] as num?)?.toDouble() ?? 0;
                          final discountRate = (item['discountRate'] as num?)?.toDouble() ?? 0;
                          return taxRate > 0 || discountRate > 0;
                        }))
                          _TableCell('Details', isHeader: true),
                        _TableCell('Total', isHeader: true),
                      ],
                    ),
                    ...items.map((item) {
                      final quantity = (item['quantity'] as num?)?.toDouble() ?? 0;
                      final unitPrice = (item['unitPrice'] as num?)?.toDouble() ?? 0;
                      final taxRate = (item['taxRate'] as num?)?.toDouble() ?? 0;
                      final discountRate = (item['discountRate'] as num?)?.toDouble() ?? 0;
                      final description = item['description'] as String? ?? '';
                      
                      final lineSubtotal = quantity * unitPrice;
                      final discount = lineSubtotal * (discountRate / 100);
                      final afterDiscount = lineSubtotal - discount;
                      final tax = afterDiscount * (taxRate / 100);
                      final lineTotal = afterDiscount + tax;
                      
                      final hasDetails = taxRate > 0 || discountRate > 0;
                      final detailsText = <String>[];
                      if (discountRate > 0) {
                        detailsText.add('Disc: ${discountRate.toStringAsFixed(1)}%');
                      }
                      if (taxRate > 0) {
                        detailsText.add('Tax: ${taxRate.toStringAsFixed(1)}%');
                      }
                      
                      return TableRow(
                        children: [
                          _TableCell(description),
                          _TableCell(quantity.toStringAsFixed(0)),
                          _TableCell('$currency${unitPrice.toStringAsFixed(2)}'),
                          if (hasDetails)
                            _TableCell(detailsText.join('\n'), isSmall: true),
                          _TableCell('$currency${lineTotal.toStringAsFixed(2)}'),
                        ],
                      );
                    }),
                  ],
                ),
                const SizedBox(height: 24),
                
                // Totals
                Align(
                  alignment: Alignment.centerRight,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      _TotalRow('Subtotal', '$currency${subtotal.toStringAsFixed(2)}'),
                      if (discountTotal > 0 || items.any((item) {
                        final discountRate = (item['discountRate'] as num?)?.toDouble() ?? 0;
                        return discountRate > 0;
                      }))
                        _TotalRow(
                          'Discount', 
                          '-$currency${discountTotal > 0 ? discountTotal.toStringAsFixed(2) : items.fold<double>(0.0, (sum, item) {
                            final quantity = (item['quantity'] as num?)?.toDouble() ?? 0;
                            final unitPrice = (item['unitPrice'] as num?)?.toDouble() ?? 0;
                            final discountRate = (item['discountRate'] as num?)?.toDouble() ?? 0;
                            if (discountRate > 0) {
                              final itemSubtotal = quantity * unitPrice;
                              return sum + (itemSubtotal * discountRate / 100);
                            }
                            return sum;
                          }).toStringAsFixed(2)}'
                        ),
                      if (taxTotal > 0)
                        _TotalRow('Tax', '$currency${taxTotal.toStringAsFixed(2)}'),
                      const Divider(),
                      _TotalRow(
                        'Total',
                        '$currency${total.toStringAsFixed(2)}',
                        isTotal: true,
                      ),
                    ],
                  ),
                ),
                
                // Notes
                if (notes != null && notes!.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text(
                    'Notes:',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(notes!),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Color _getStatusColor(InvoiceStatus status) {
    switch (status) {
      case InvoiceStatus.paid:
        return Colors.green;
      case InvoiceStatus.overdue:
        return Colors.red;
      case InvoiceStatus.sent:
        return Colors.blue;
      case InvoiceStatus.draft:
        return Colors.grey;
      case InvoiceStatus.cancelled:
        return Colors.grey;
    }
  }
}

class _TableCell extends StatelessWidget {
  final String text;
  final bool isHeader;
  final bool isSmall;

  const _TableCell(this.text, {this.isHeader = false, this.isSmall = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Text(
        text,
        style: TextStyle(
          fontWeight: isHeader ? FontWeight.bold : FontWeight.normal,
          fontSize: isSmall ? 11 : null,
        ),
      ),
    );
  }
}

class _TotalRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isTotal;

  const _TotalRow(this.label, this.value, {this.isTotal = false});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 100,
            child: Text(
              label,
              style: TextStyle(
                fontWeight: isTotal ? FontWeight.bold : FontWeight.normal,
                fontSize: isTotal ? 16 : 14,
              ),
            ),
          ),
          SizedBox(
            width: 100,
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                fontWeight: isTotal ? FontWeight.bold : FontWeight.normal,
                fontSize: isTotal ? 18 : 14,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

