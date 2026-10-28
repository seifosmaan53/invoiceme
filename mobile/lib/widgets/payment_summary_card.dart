import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/payment_summary.dart';

/// Payment state of an invoice, separate from the invoice's own status.
///
/// When money was refunded or disputed, gross paid, refunded/disputed and net
/// received are shown as three separately labelled amounts; none of them is
/// presented as the invoice total or as an amount owed.
class PaymentSummaryCard extends StatelessWidget {
  final PaymentSummary? summary;

  /// Called when the user asks to reopen (only offered when `canReopen`).
  final VoidCallback? onReopen;

  const PaymentSummaryCard({super.key, required this.summary, this.onReopen});

  String _money(String amount, String currency) {
    final value = double.tryParse(amount);
    if (value == null) return '$amount $currency'.trim();
    try {
      return NumberFormat.simpleCurrency(name: currency.isEmpty ? null : currency).format(value);
    } catch (_) {
      return '${value.toStringAsFixed(2)} $currency'.trim();
    }
  }

  Color _chipColor(String state) {
    switch (state) {
      case 'paid':
        return Colors.green;
      case 'partially_refunded':
      case 'refunded':
        return Colors.blueGrey;
      case 'disputed':
        return Colors.orange;
      case 'dispute_lost':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = summary;
    if (s == null || s.stateLabel == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final showBreakdown = s.hasRefund || s.hasDispute;

    Widget amountRow(String label, String amount, {Key? key, bool bold = false}) => Padding(
          key: key,
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            children: [
              Expanded(child: Text(label)),
              Text(
                _money(amount, s.currency),
                style: bold ? const TextStyle(fontWeight: FontWeight.bold) : null,
              ),
            ],
          ),
        );

    return Card(
      key: const ValueKey('payment-summary'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Payment', style: theme.textTheme.titleMedium),
                const SizedBox(width: 12),
                Chip(
                  key: const ValueKey('payment-state-chip'),
                  label: Text(s.stateLabel!),
                  backgroundColor: _chipColor(s.state).withValues(alpha: 0.15),
                  side: BorderSide(color: _chipColor(s.state)),
                ),
              ],
            ),
            if (showBreakdown) ...[
              const SizedBox(height: 8),
              amountRow('Paid (gross)', s.grossPaid, key: const ValueKey('amount-gross')),
              if (s.hasRefund) amountRow('Refunded', s.refunded, key: const ValueKey('amount-refunded')),
              if (s.hasDispute) amountRow('Disputed', s.disputed, key: const ValueKey('amount-disputed')),
              const Divider(),
              amountRow('Net received', s.net, key: const ValueKey('amount-net'), bold: true),
            ],
            if (s.canReopen && onReopen != null) ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  key: const ValueKey('reopen-invoice'),
                  icon: const Icon(Icons.lock_open),
                  label: const Text('Reopen invoice'),
                  onPressed: onReopen,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
