class ApiKey {
  final String id;
  final String userId;
  final String name;
  final List<String> permissions;
  final DateTime? expiresAt;
  final bool isActive;
  final DateTime? lastUsedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String? key; // Only present when first created

  ApiKey({
    required this.id,
    required this.userId,
    required this.name,
    required this.permissions,
    this.expiresAt,
    required this.isActive,
    this.lastUsedAt,
    required this.createdAt,
    required this.updatedAt,
    this.key,
  });

  factory ApiKey.fromJson(Map<String, dynamic> json) {
    return ApiKey(
      id: json['id'] as String,
      userId: json['userId'] ?? json['user_id'] as String,
      name: json['name'] as String,
      permissions: (json['permissionsJson'] ?? json['permissions_json'] ?? [])
          .map((p) => p.toString())
          .toList()
          .cast<String>(),
      expiresAt: json['expiresAt'] != null || json['expires_at'] != null
          ? DateTime.parse(json['expiresAt'] ?? json['expires_at'])
          : null,
      isActive: json['isActive'] ?? json['is_active'] as bool? ?? true,
      lastUsedAt: json['lastUsedAt'] != null || json['last_used_at'] != null
          ? DateTime.parse(json['lastUsedAt'] ?? json['last_used_at'])
          : null,
      createdAt: DateTime.parse(json['createdAt'] ?? json['created_at']),
      updatedAt: DateTime.parse(json['updatedAt'] ?? json['updated_at']),
      key: json['key'] as String?,
    );
  }
}

