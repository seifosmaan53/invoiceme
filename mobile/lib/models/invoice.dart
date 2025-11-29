import 'dart:convert';
import 'client.dart';
import 'invoice_item.dart';

enum InvoiceType { invoice, estimate }

enum InvoiceStatus { draft, sent, paid, overdue, cancelled }

class Invoice {
  final String id;
  final String userId;
  final String clientId;
  final InvoiceType type;
  final String number;
  final InvoiceStatus status;
  final DateTime issueDate;
  final DateTime? dueDate;
  final String currency;
  final double subtotal;
  final double taxTotal;
  final double discountTotal;
  final double total;
  final String? notes;
  final Map<String, dynamic>? metadataJson;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? deletedAt;
  final Client? client;
  final List<InvoiceItem>? items;

  Invoice({
    required this.id,
    required this.userId,
    required this.clientId,
    required this.type,
    required this.number,
    required this.status,
    required this.issueDate,
    this.dueDate,
    required this.currency,
    required this.subtotal,
    required this.taxTotal,
    required this.discountTotal,
    required this.total,
    this.notes,
    this.metadataJson,
    required this.createdAt,
    required this.updatedAt,
    this.deletedAt,
    this.client,
    this.items,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user_id': userId,
      'client_id': clientId,
      'type': type.name,
      'number': number,
      'status': status.name,
      'issue_date': issueDate.toIso8601String().split('T')[0],
      'due_date': dueDate?.toIso8601String().split('T')[0],
      'currency': currency,
      'subtotal': subtotal,
      'tax_total': taxTotal,
      'discount_total': discountTotal,
      'total': total,
      'notes': notes,
      'metadata_json': metadataJson,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
      'deleted_at': deletedAt?.toIso8601String(),
      'client': client?.toJson(),
      'items': items?.map((item) => item.toJson()).toList(),
    };
  }

  factory Invoice.fromJson(Map<String, dynamic> json) {
    return Invoice(
      id: json['id'] ?? '',
      userId: json['user_id'] ?? json['userId'] ?? '',
      clientId: json['client_id'] ?? json['clientId'] ?? '',
      type: InvoiceType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => InvoiceType.invoice,
      ),
      number: json['number'] ?? '',
      status: InvoiceStatus.values.firstWhere(
        (e) => e.name == json['status'],
        orElse: () => InvoiceStatus.draft,
      ),
      issueDate: DateTime.tryParse(json['issue_date'] ?? json['issueDate'] ?? '') ?? DateTime.now(),
      dueDate: json['due_date'] != null || json['dueDate'] != null
          ? DateTime.parse(json['due_date'] ?? json['dueDate'])
          : null,
      currency: json['currency'] ?? 'USD',
      subtotal: _parseDouble(json['subtotal']),
      taxTotal: _parseDouble(json['tax_total'] ?? json['taxTotal']),
      discountTotal: _parseDouble(json['discount_total'] ?? json['discountTotal']),
      total: _parseDouble(json['total']),
      notes: json['notes'],
      metadataJson: json['metadata_json'] != null
          ? Map<String, dynamic>.from(json['metadata_json'] ?? json['metadataJson'])
          : null,
      createdAt: DateTime.tryParse(json['created_at'] ?? json['createdAt'] ?? '') ?? DateTime.now(),
      updatedAt: DateTime.tryParse(json['updated_at'] ?? json['updatedAt'] ?? '') ?? DateTime.now(),
      deletedAt: json['deleted_at'] != null || json['deletedAt'] != null
          ? DateTime.parse(json['deleted_at'] ?? json['deletedAt'])
          : null,
      client: json['client'] != null ? Client.fromJson(json['client']) : null,
      items: json['items'] != null
          ? (json['items'] as List).map((item) => InvoiceItem.fromJson(item)).toList()
          : null,
    );
  }

  String? get clientName => client?.name;
  String? get clientEmail => client?.email;

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
      'user_id': userId,
      'client_id': clientId,
      'type': type.name,
      'number': number,
      'status': status.name,
      'issue_date': issueDate.toIso8601String().split('T')[0],
      'due_date': dueDate?.toIso8601String().split('T')[0],
      'currency': currency,
      'subtotal': subtotal,
      'tax_total': taxTotal,
      'discount_total': discountTotal,
      'total': total,
      'notes': notes,
      'metadata_json': metadataJson != null ? jsonEncode(metadataJson) : null,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
      'deleted_at': deletedAt?.toIso8601String(),
    };
  }

  factory Invoice.fromDatabaseMap(Map<String, dynamic> map) {
    return Invoice(
      id: map['id'],
      userId: map['user_id'],
      clientId: map['client_id'],
      type: InvoiceType.values.firstWhere(
        (e) => e.name == map['type'],
        orElse: () => InvoiceType.invoice,
      ),
      number: map['number'] ?? '',
      status: InvoiceStatus.values.firstWhere(
        (e) => e.name == map['status'],
        orElse: () => InvoiceStatus.draft,
      ),
      issueDate: DateTime.tryParse(map['issue_date'] ?? '') ?? DateTime.now(),
      dueDate: map['due_date'] != null ? DateTime.tryParse(map['due_date']) : null,
      currency: map['currency'] ?? 'USD',
      subtotal: map['subtotal']?.toDouble() ?? 0,
      taxTotal: map['tax_total']?.toDouble() ?? 0,
      discountTotal: map['discount_total']?.toDouble() ?? 0,
      total: map['total']?.toDouble() ?? 0,
      notes: map['notes'],
      metadataJson: map['metadata_json'] != null
          ? Map<String, dynamic>.from(jsonDecode(map['metadata_json']))
          : null,
      createdAt: DateTime.tryParse(map['created_at'] ?? '') ?? DateTime.now(),
      updatedAt: DateTime.tryParse(map['updated_at'] ?? '') ?? DateTime.now(),
      deletedAt: map['deleted_at'] != null ? DateTime.parse(map['deleted_at']) : null,
    );
  }

  /// Returns a payload suitable for API create/update requests
  /// Excludes id, timestamps, and deletedAt (server handles these)
  Map<String, dynamic> toApiPayload() {
    return {
      'clientId': clientId,
      'type': type.name,
      'issueDate': issueDate.toIso8601String().split('T')[0],
      if (dueDate != null) 'dueDate': dueDate!.toIso8601String().split('T')[0],
      'currency': currency,
      'items': items?.map((item) => {
          'description': item.description,
          'quantity': item.quantity,
          'unitPrice': item.unitPrice,
          if (item.taxRate > 0) 'taxRate': item.taxRate,
          if (item.discountRate > 0) 'discountRate': item.discountRate,
      }).toList() ?? [],
      if (notes != null && notes!.isNotEmpty) 'notes': notes,
      'status': status.name,
      if (metadataJson != null) 'metadataJson': metadataJson,
    };
  }
}

