// Flutter imports
import 'package:flutter/material.dart';

// Package imports
import 'package:intl/intl.dart';

/// Widget to display active filter chips for clients
class ClientFilterChips extends StatelessWidget {
  final List<String> selectedTags;
  final DateTime? dateFrom;
  final DateTime? dateTo;
  final VoidCallback? onClearTags;
  final VoidCallback? onClearDateRange;
  final VoidCallback? onClearAll;

  const ClientFilterChips({
    super.key,
    required this.selectedTags,
    this.dateFrom,
    this.dateTo,
    this.onClearTags,
    this.onClearDateRange,
    this.onClearAll,
  });

  bool get hasActiveFilters => selectedTags.isNotEmpty || dateFrom != null || dateTo != null;

  @override
  Widget build(BuildContext context) {
    if (!hasActiveFilters) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          // Tag filters
          ...selectedTags.map((tag) => Chip(
                label: Text(tag),
                deleteIcon: const Icon(Icons.close, size: 18),
                onDeleted: onClearTags != null
                    ? () {
                        // This will be handled by parent
                        onClearTags?.call();
                      }
                    : null,
                backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                labelStyle: TextStyle(
                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                  fontSize: 12,
                ),
              )),
          
          // Date range filter
          if (dateFrom != null || dateTo != null)
            Chip(
              label: Text(
                _formatDateRange(),
                style: const TextStyle(fontSize: 12),
              ),
              deleteIcon: const Icon(Icons.close, size: 18),
              onDeleted: onClearDateRange,
              backgroundColor: Theme.of(context).colorScheme.secondaryContainer,
              labelStyle: TextStyle(
                color: Theme.of(context).colorScheme.onSecondaryContainer,
                fontSize: 12,
              ),
            ),
          
          // Clear all button
          if (hasActiveFilters)
            ActionChip(
              label: const Text('Clear All', style: TextStyle(fontSize: 12)),
              onPressed: onClearAll,
              backgroundColor: Theme.of(context).colorScheme.surfaceVariant,
              labelStyle: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
                fontSize: 12,
              ),
            ),
        ],
      ),
    );
  }

  String _formatDateRange() {
    final dateFormat = DateFormat('MMM d, y');
    if (dateFrom != null && dateTo != null) {
      return '${dateFormat.format(dateFrom!)} - ${dateFormat.format(dateTo!)}';
    } else if (dateFrom != null) {
      return 'From ${dateFormat.format(dateFrom!)}';
    } else if (dateTo != null) {
      return 'Until ${dateFormat.format(dateTo!)}';
    }
    return '';
  }
}

