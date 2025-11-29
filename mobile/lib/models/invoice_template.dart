class InvoiceTemplate {
  final String id;
  final String userId;
  final String name;
  final String? description;
  final String type; // 'invoice' or 'estimate'
  final String currency;
  final int defaultDueDays;
  final List<InvoiceTemplateItem> items;
  final String? notes;
  final DateTime createdAt;
  final DateTime updatedAt;

  InvoiceTemplate({
    required this.id,
    required this.userId,
    required this.name,
    this.description,
    required this.type,
    required this.currency,
    required this.defaultDueDays,
    required this.items,
    this.notes,
    required this.createdAt,
    required this.updatedAt,
  });

  factory InvoiceTemplate.fromJson(Map<String, dynamic> json) {
    return InvoiceTemplate(
      id: json['id'] as String,
      userId: json['userId'] ?? json['user_id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      type: json['type'] as String? ?? 'invoice',
      currency: json['currency'] as String? ?? 'USD',
      defaultDueDays: json['defaultDueDays'] ?? json['default_due_days'] as int? ?? 30,
      items: (json['lineItemsJson'] ?? json['line_items_json'] ?? [])
          .map((item) => InvoiceTemplateItem.fromJson(item))
          .toList()
          .cast<InvoiceTemplateItem>(),
      notes: json['notes'] as String?,
      createdAt: DateTime.parse(json['createdAt'] ?? json['created_at']),
      updatedAt: DateTime.parse(json['updatedAt'] ?? json['updated_at']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'name': name,
      'description': description,
      'type': type,
      'currency': currency,
      'defaultDueDays': defaultDueDays,
      'lineItemsJson': items.map((item) => item.toJson()).toList(),
      'notes': notes,
    };
  }
}

class InvoiceTemplateItem {
  final String description;
  final double quantity;
  final double unitPrice;

  InvoiceTemplateItem({
    required this.description,
    required this.quantity,
    required this.unitPrice,
  });

  factory InvoiceTemplateItem.fromJson(Map<String, dynamic> json) {
    return InvoiceTemplateItem(
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

