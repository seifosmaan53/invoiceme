import 'package:flutter/material.dart';

/// Widget to display field-level validation errors
class FieldErrorWidget extends StatelessWidget {
  final String? error;
  final EdgeInsets? padding;

  const FieldErrorWidget({
    super.key,
    this.error,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    if (error == null || error!.isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: padding ?? const EdgeInsets.only(top: 4.0, left: 12.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.error_outline,
            size: 16,
            color: Theme.of(context).colorScheme.error,
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(
              error!,
              style: TextStyle(
                color: Theme.of(context).colorScheme.error,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Extension to add error decoration to InputDecoration
extension InputDecorationError on InputDecoration {
  InputDecoration withError(String? error) {
    if (error == null || error.isEmpty) {
      return this;
    }
    return copyWith(
      errorText: error,
      errorStyle: const TextStyle(fontSize: 12),
    );
  }
}

