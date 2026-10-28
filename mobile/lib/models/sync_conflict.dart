/// A sync conflict as returned by `GET /sync/conflicts` (ConflictView in
/// backend/src/sync/sync-conflicts.service.ts).
class SyncConflict {
  final String id;
  final String objectType;
  final String objectId;
  final String label;
  final String kind;
  final String changeType;
  final String status;
  final String? resolution;
  final String explanation;
  final int? baseRevision;
  final int? serverRevision;
  final Map<String, dynamic> yourChanges;
  final Map<String, dynamic>? serverVersion;
  final List<String> conflictingFields;
  final List<String> omittedFields;

  /// `apply_client`, `restore`, `dismiss`: only these may be offered.
  final List<String> allowedActions;
  final DateTime? createdAt;
  final DateTime? resolvedAt;

  const SyncConflict({
    required this.id,
    required this.objectType,
    required this.objectId,
    required this.label,
    required this.kind,
    required this.changeType,
    required this.status,
    this.resolution,
    required this.explanation,
    this.baseRevision,
    this.serverRevision,
    this.yourChanges = const {},
    this.serverVersion,
    this.conflictingFields = const [],
    this.omittedFields = const [],
    this.allowedActions = const [],
    this.createdAt,
    this.resolvedAt,
  });

  factory SyncConflict.fromJson(Map<String, dynamic> json) => SyncConflict(
        id: json['id'] as String,
        objectType: json['object_type'] as String? ?? '',
        objectId: json['object_id'] as String? ?? '',
        label: json['label'] as String? ?? '',
        kind: json['kind'] as String? ?? '',
        changeType: json['change_type'] as String? ?? '',
        status: json['status'] as String? ?? '',
        resolution: json['resolution'] as String?,
        explanation: json['explanation'] as String? ?? '',
        baseRevision: _int(json['base_revision']),
        serverRevision: _int(json['server_revision']),
        yourChanges: _map(json['your_changes']) ?? const {},
        serverVersion: _map(json['server_version']),
        conflictingFields: _strings(json['conflicting_fields']),
        omittedFields: _strings(json['omitted_fields']),
        allowedActions: _strings(json['allowed_actions']),
        createdAt: _date(json['created_at']),
        resolvedAt: _date(json['resolved_at']),
      );

  /// Human-readable kind.
  String get kindLabel {
    switch (kind) {
      case 'stale_edit':
        return 'Edited in two places';
      case 'protected_invoice':
        return 'Sent or paid invoice';
      case 'edit_after_delete':
        return 'Edited after it was deleted';
      case 'delete_after_edit':
        return 'Deleted after it was edited';
      default:
        return kind;
    }
  }

  static int? _int(Object? v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
  static Map<String, dynamic>? _map(Object? v) => v is Map ? Map<String, dynamic>.from(v) : null;
  static List<String> _strings(Object? v) => v is List ? v.map((e) => e.toString()).toList() : const [];
  static DateTime? _date(Object? v) => v is String ? DateTime.tryParse(v) : null;
}

/// The record as it is now (`current` of `GET /sync/conflicts/:id`).
class SyncConflictCurrent {
  final int? revision;
  final bool deleted;
  final Map<String, dynamic>? fields;

  const SyncConflictCurrent({this.revision, this.deleted = false, this.fields});

  factory SyncConflictCurrent.fromJson(Map<String, dynamic>? json) => SyncConflictCurrent(
        revision: SyncConflict._int(json?['revision']),
        deleted: json?['deleted'] == true,
        fields: SyncConflict._map(json?['fields']),
      );
}

/// `GET /sync/conflicts/:id`: the conflict plus the record as it is now.
class SyncConflictDetail {
  final SyncConflict conflict;
  final SyncConflictCurrent current;

  const SyncConflictDetail(this.conflict, this.current);

  factory SyncConflictDetail.fromJson(Map<String, dynamic> json) => SyncConflictDetail(
        SyncConflict.fromJson(json),
        SyncConflictCurrent.fromJson(json['current'] is Map ? Map<String, dynamic>.from(json['current']) : null),
      );

  /// Fields to compare: what this device changed, plus any conflicting field.
  /// A delete carries no fields; then the fields of the server's version are
  /// shown (what the delete removed).
  List<String> get comparedFields {
    final fields = <String>[...conflict.yourChanges.keys];
    if (fields.isEmpty && conflict.changeType == 'delete') {
      fields.addAll(conflict.serverVersion?.keys ?? const <String>[]);
    }
    for (final f in conflict.conflictingFields) {
      if (!fields.contains(f)) fields.add(f);
    }
    return fields;
  }
}
