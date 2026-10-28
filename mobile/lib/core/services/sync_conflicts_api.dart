// Package imports
import 'package:dio/dio.dart' show DioException;

// Local imports
import '../../models/sync_conflict.dart';
import 'api_client.dart';

/// An error answer of the conflicts API (404, 409, 422, ...).
class SyncConflictsApiException implements Exception {
  final int? statusCode;
  final String message;

  /// 409 when the record changed after it was reviewed.
  final int? currentRevision;

  const SyncConflictsApiException(this.statusCode, this.message, {this.currentRevision});

  @override
  String toString() => 'SyncConflictsApiException($statusCode, $message)';
}

/// The conflicts API (docs/SYNC-CONTRACT.md, "Conflicts API"). Answers only
/// for the signed-in user; nothing is cached.
abstract class SyncConflictsApi {
  Future<List<SyncConflict>> listOpen();
  Future<SyncConflictDetail> get(String id);

  /// [action]: `apply_client`, `restore` or `dismiss`.
  Future<SyncConflictDetail> resolve(String id, String action, {int? expectedRevision});
}

class ApiSyncConflictsApi implements SyncConflictsApi {
  final ApiClient _api;

  ApiSyncConflictsApi(this._api);

  @override
  Future<List<SyncConflict>> listOpen() => _call(() async {
        final res = await _api.get('/sync/conflicts', queryParameters: {'status': 'open'}, useCache: false);
        final data = res.data;
        if (data is! List) return <SyncConflict>[];
        return data.whereType<Map>().map((e) => SyncConflict.fromJson(Map<String, dynamic>.from(e))).toList();
      });

  @override
  Future<SyncConflictDetail> get(String id) => _call(() async {
        final res = await _api.get('/sync/conflicts/${Uri.encodeComponent(id)}', useCache: false);
        return SyncConflictDetail.fromJson(Map<String, dynamic>.from(res.data as Map));
      });

  @override
  Future<SyncConflictDetail> resolve(String id, String action, {int? expectedRevision}) => _call(() async {
        final res = await _api.post('/sync/conflicts/${Uri.encodeComponent(id)}/resolve', data: {
          'action': action,
          if (expectedRevision != null) 'expected_revision': expectedRevision,
        });
        return SyncConflictDetail.fromJson(Map<String, dynamic>.from(res.data as Map));
      });

  Future<T> _call<T>(Future<T> Function() body) async {
    try {
      return await body();
    } on DioException catch (e) {
      final data = e.response?.data;
      var message = e.message ?? 'Request failed';
      int? currentRevision;
      if (data is Map) {
        final m = data['message'];
        if (m is String) message = m;
        if (m is List && m.isNotEmpty) message = m.join(', ');
        final cr = data['current_revision'];
        if (cr is num) currentRevision = cr.toInt();
      }
      throw SyncConflictsApiException(e.response?.statusCode, message, currentRevision: currentRevision);
    }
  }
}
