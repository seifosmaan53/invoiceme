import 'dart:convert';

class InvoiceItem {
  final String id;
  final String invoiceId;
  final String description;
  final double quantity;
  final double unitPrice;
  final double taxRate;
  final double discountRate;
  final double lineTotal;
  final DateTime createdAt;

  InvoiceItem({
    required this.id,
    required this.invoiceId,
    required this.description,
    required this.quantity,
    required this.unitPrice,
    required this.taxRate,
    required this.discountRate,
    required this.lineTotal,
    required this.createdAt,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'invoice_id': invoiceId,
      'description': description,
      'quantity': quantity,
      'unit_price': unitPrice,
      'tax_rate': taxRate,
      'discount_rate': discountRate,
      'line_total': lineTotal,
      'created_at': createdAt.toIso8601String(),
    };
  }

  factory InvoiceItem.fromJson(Map<String, dynamic> json) {
    return InvoiceItem(
      id: json['id'],
      invoiceId: json['invoice_id'] ?? json['invoiceId'],
      description: json['description'],
      quantity: _parseDouble(json['quantity']),
      unitPrice: _parseDouble(json['unit_price'] ?? json['unitPrice']),
      taxRate: _parseDouble(json['tax_rate'] ?? json['taxRate']),
      discountRate: _parseDouble(json['discount_rate'] ?? json['discountRate']),
      lineTotal: _parseDouble(json['line_total'] ?? json['lineTotal']),
      createdAt: DateTime.parse(json['created_at'] ?? json['createdAt']),
    );
  }

  static double _parseDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) {
      return double.tryParse(value) ?? 0.0;
    }
    if (value is num) return value.toDouble();
    return 0.0;
  }

  Map<String, dynamic> toDatabaseMap() {
    return {
      'id': id,
      'invoice_id': invoiceId,
      'description': description,
      'quantity': quantity,
      'unit_price': unitPrice,
      'tax_rate': taxRate,
      'discount_rate': discountRate,
      'line_total': lineTotal,
      'created_at': createdAt.toIso8601String(),
    };
  }

  factory InvoiceItem.fromDatabaseMap(Map<String, dynamic> map) {
    return InvoiceItem(
      id: map['id'],
      invoiceId: map['invoice_id'],
      description: map['description'],
      quantity: map['quantity']?.toDouble() ?? 0,
      unitPrice: map['unit_price']?.toDouble() ?? 0,
      taxRate: map['tax_rate']?.toDouble() ?? 0,
      discountRate: map['discount_rate']?.toDouble() ?? 0,
      lineTotal: map['line_total']?.toDouble() ?? 0,
      createdAt: DateTime.parse(map['created_at']),
    );
  }
}
