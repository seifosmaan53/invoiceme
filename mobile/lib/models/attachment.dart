class Attachment {
  final String id;
  final String ownerId;
  final String ownerType;
  final String url;
  final String filename;
  final String contentType;
  final int sizeBytes;
  final DateTime createdAt;
  final DateTime updatedAt;

  Attachment({
    required this.id,
    required this.ownerId,
    required this.ownerType,
    required this.url,
    required this.filename,
    required this.contentType,
    required this.sizeBytes,
    required this.createdAt,
    required this.updatedAt,
  });

  factory Attachment.fromJson(Map<String, dynamic> json) {
    return Attachment(
      id: json['id'] as String,
      ownerId: json['owner_id'] ?? json['ownerId'],
      ownerType: json['owner_type'] ?? json['ownerType'],
      url: json['url'] as String,
      filename: json['filename'] as String,
      contentType: json['content_type'] ?? json['contentType'],
      sizeBytes: json['size_bytes'] ?? json['sizeBytes'] ?? 0,
      createdAt: DateTime.parse(json['created_at'] ?? json['createdAt']),
      updatedAt: json['updated_at'] != null || json['updatedAt'] != null
          ? DateTime.parse(json['updated_at'] ?? json['updatedAt'])
          : DateTime.parse(json['created_at'] ?? json['createdAt']), // Fallback to createdAt if updatedAt missing
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'owner_id': ownerId,
      'owner_type': ownerType,
      'url': url,
      'filename': filename,
      'content_type': contentType,
      'size_bytes': sizeBytes,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  Map<String, dynamic> toDatabaseMap() {
    return {
      'id': id,
      'owner_id': ownerId,
      'owner_type': ownerType,
      'url': url,
      'filename': filename,
      'content_type': contentType,
      'size_bytes': sizeBytes,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  factory Attachment.fromDatabaseMap(Map<String, dynamic> map) {
    return Attachment(
      id: map['id'] as String,
      ownerId: map['owner_id'] as String,
      ownerType: map['owner_type'] as String,
      url: map['url'] as String,
      filename: map['filename'] as String,
      contentType: map['content_type'] as String,
      sizeBytes: (map['size_bytes'] as int?) ?? 0,
      createdAt: DateTime.parse(map['created_at'] as String),
      updatedAt: DateTime.parse(map['updated_at'] as String),
    );
  }
}

