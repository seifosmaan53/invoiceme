enum RecurrenceFrequency {
  daily,
  weekly,
  monthly,
  quarterly,
  yearly,
}

class RecurringInvoice {
  final String id;
  final String userId;
  final String clientId;
  final String name;
  final RecurrenceFrequency frequency;
  final int interval;
  final DateTime startDate;
  final DateTime? endDate;
  final DateTime nextRunDate;
  final String currency;
  final List<RecurringInvoiceItem> items;
  final String? notes;
  final bool isActive;
  final int invoicesGenerated;
  final DateTime createdAt;
  final DateTime updatedAt;

  RecurringInvoice({
    required this.id,
    required this.userId,
    required this.clientId,
    required this.name,
    required this.frequency,
    required this.interval,
    required this.startDate,
    this.endDate,
    required this.nextRunDate,
    required this.currency,
    required this.items,
    this.notes,
    required this.isActive,
    required this.invoicesGenerated,
    required this.createdAt,
    required this.updatedAt,
  });

  factory RecurringInvoice.fromJson(Map<String, dynamic> json) {
    return RecurringInvoice(
      id: json['id'] as String,
      userId: json['userId'] ?? json['user_id'] as String,
      clientId: json['clientId'] ?? json['client_id'] as String,
      name: json['name'] as String,
      frequency: RecurrenceFrequency.values.firstWhere(
        (e) => e.name == (json['frequency'] as String).toLowerCase(),
        orElse: () => RecurrenceFrequency.monthly,
      ),
      interval: json['interval'] as int? ?? 1,
      startDate: DateTime.parse(json['startDate'] ?? json['start_date']),
      endDate: json['endDate'] != null || json['end_date'] != null
          ? DateTime.parse(json['endDate'] ?? json['end_date'])
          : null,
      nextRunDate: DateTime.parse(json['nextRunDate'] ?? json['next_run_date']),
      currency: json['currency'] as String? ?? 'USD',
      items: (json['lineItemsJson'] ?? json['line_items_json'] ?? [])
          .map((item) => RecurringInvoiceItem.fromJson(item))
          .toList()
          .cast<RecurringInvoiceItem>(),
      notes: json['notes'] as String?,
      isActive: json['isActive'] ?? json['is_active'] as bool? ?? true,
      invoicesGenerated: json['invoicesGenerated'] ?? json['invoices_generated'] as int? ?? 0,
      createdAt: DateTime.parse(json['createdAt'] ?? json['created_at']),
      updatedAt: DateTime.parse(json['updatedAt'] ?? json['updated_at']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'clientId': clientId,
      'frequency': frequency.name,
      'interval': interval,
      'startDate': startDate.toIso8601String().split('T')[0],
      'endDate': endDate?.toIso8601String().split('T')[0],
      'nextRunDate': nextRunDate.toIso8601String().split('T')[0],
      'currency': currency,
      'lineItemsJson': items.map((item) => item.toJson()).toList(),
      'notes': notes,
      'isActive': isActive,
    };
  }
}

class RecurringInvoiceItem {
  final String description;
  final double quantity;
  final double unitPrice;

  RecurringInvoiceItem({
    required this.description,
    required this.quantity,
    required this.unitPrice,
  });

  factory RecurringInvoiceItem.fromJson(Map<String, dynamic> json) {
    return RecurringInvoiceItem(
      description: json['description'] as String,
      quantity: (json['quantity'] as num).toDouble(),
      unitPrice: (json['unitPrice'] ?? json['unit_price'] as num).toDouble(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'description': description,
      'quantity': quantity,
      'unitPrice': unitPrice,
    };
  }
}

