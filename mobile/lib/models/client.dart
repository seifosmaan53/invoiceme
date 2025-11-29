import 'dart:convert';

class Client {
  final String id;
  final String userId;
  final String name;
  final String? email;
  final String? phone;
  final Map<String, dynamic>? addressJson;
  final String? notes;
  final List<String>? tags;
  final String? avatarUrl;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? deletedAt;

  Client({
    required this.id,
    required this.userId,
    required this.name,
    this.email,
    this.phone,
    this.addressJson,
    this.notes,
    this.tags,
    this.avatarUrl,
    required this.createdAt,
    required this.updatedAt,
    this.deletedAt,
  });

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user_id': userId,
      'name': name,
      'email': email,
      'phone': phone,
      'address_json': addressJson,
      'notes': notes,
      'tags_json': tags,
      'avatar_url': avatarUrl,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
      'deleted_at': deletedAt?.toIso8601String(),
    };
  }

  /// Returns a payload suitable for API create/update requests
  /// Excludes id, timestamps, and deletedAt (server handles these)
  /// Uses snake_case for address_json to match DTO
  /// Uses 'tags' (not 'tags_json') as the DTO expects 'tags?: string[]'
  Map<String, dynamic> toApiPayload() {
    return {
      'name': name,
      if (email != null && email!.isNotEmpty) 'email': email,
      if (phone != null && phone!.isNotEmpty) 'phone': phone,
      if (addressJson != null) 'address_json': addressJson,
      if (notes != null && notes!.isNotEmpty) 'notes': notes,
      if (tags != null && tags!.isNotEmpty) 'tags': tags,
      if (avatarUrl != null && avatarUrl!.isNotEmpty) 'avatar_url': avatarUrl,
    };
  }

  factory Client.fromJson(Map<String, dynamic> json) {
    return Client(
      id: json['id'] as String,
      userId: json['user_id'] ?? json['userId'],
      name: json['name'] as String,
      email: json['email'] as String?,
      phone: json['phone'] as String?,
      addressJson: json['address_json'] != null
          ? (json['address_json'] is String
              ? Map<String, dynamic>.from(jsonDecode(json['address_json']))
              : Map<String, dynamic>.from(json['address_json']))
          : null,
      notes: json['notes'] as String?,
      avatarUrl: json['avatar_url'] ?? json['avatarUrl'] as String?,
      tags: (() {
        final raw = json['tags_json'] ?? json['tags'] ?? json['tagsJson'];
        if (raw == null) return null;
        if (raw is List) return List<String>.from(raw);
        if (raw is String) return List<String>.from(jsonDecode(raw));
        return null;
      })(),
      createdAt: DateTime.parse(json['created_at'] ?? json['createdAt']),
      updatedAt: DateTime.parse(json['updated_at'] ?? json['updatedAt']),
      deletedAt: json['deleted_at'] != null || json['deletedAt'] != null
          ? DateTime.parse(json['deleted_at'] ?? json['deletedAt'])
          : null,
    );
  }

  Map<String, dynamic> toDatabaseMap() {
    return {
      'id': id,
      'user_id': userId,
      'name': name,
      'email': email,
      'phone': phone,
      'address_json': addressJson != null ? jsonEncode(addressJson) : null,
      'notes': notes,
      'tags_json': tags != null ? jsonEncode(tags) : null,
      'avatar_url': avatarUrl,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
      'deleted_at': deletedAt?.toIso8601String(),
    };
  }

  factory Client.fromDatabaseMap(Map<String, dynamic> map) {
    return Client(
      id: map['id'],
      userId: map['user_id'],
      name: map['name'],
      email: map['email'],
      phone: map['phone'],
      addressJson: map['address_json'] != null
          ? Map<String, dynamic>.from(jsonDecode(map['address_json']))
          : null,
      notes: map['notes'],
      avatarUrl: map['avatar_url'],
      tags: map['tags_json'] != null
          ? (map['tags_json'] is String
              ? List<String>.from(jsonDecode(map['tags_json']))
              : List<String>.from(map['tags_json']))
          : null,
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: DateTime.parse(map['updated_at']),
      deletedAt: map['deleted_at'] != null ? DateTime.parse(map['deleted_at']) : null,
    );
  }
}

