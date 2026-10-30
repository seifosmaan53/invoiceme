// Shared fakes for the account isolation tests: a temp-directory path
// provider and a simulated server with synthetic accounts A and B.

// Dart imports
import 'dart:async';
import 'dart:convert';

// Package imports
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';

// Local imports
import 'package:invoiceme/core/services/api_client.dart';

class TempPathProvider extends PathProviderPlatform with MockPlatformInterfaceMixin {
  final String root;
  TempPathProvider(this.root);
  @override
  Future<String?> getApplicationDocumentsPath() async => root;
  @override
  Future<String?> getTemporaryPath() async => '$root/tmp';
  @override
  Future<String?> getApplicationSupportPath() async => root;
}

/// Unsigned JWT with `sub` (the app only reads the claims; the server verifies).
String fakeJwt(String userId) {
  String part(Map<String, Object> m) => base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  return '${part({'alg': 'none'})}.${part({'sub': userId, 'email': '$userId@example.test'})}.sig';
}

/// Simulated server with two synthetic accounts. Requests are attributed to
/// the account whose access token the client holds.
class TwoAccountServer extends ApiClient {
  String? token;
  final pushesBy = <String, List<Map<String, dynamic>>>{};
  final pullCursorsBy = <String, List<String?>>{};

  /// Every request as (account, path).
  final requests = <(String?, String)>[];

  /// When set, the next push / pull waits for it (an in-flight request).
  Completer<void>? pushGate;
  Completer<void>? pullGate;

  /// Completed when a gated request has been received.
  Completer<void> requestArrived = Completer<void>();

  /// Conflict detail answers: id -> status ('open', 'resolved'); others 404.
  final conflictStatus = <String, String>{};

  /// Records the server holds per account (returned by a full pull).
  final records = <String, List<Map<String, dynamic>>>{
    'user-a': [clientJson('a-client-1', 'user-a', 'A Client')],
    'user-b': [clientJson('b-client-1', 'user-b', 'B Client')],
  };

  static Map<String, dynamic> clientJson(String id, String userId, String name) => {
        'id': id,
        'userId': userId,
        'name': name,
        'createdAt': '2026-10-01T00:00:00.000Z',
        'updatedAt': '2026-10-01T00:00:00.000Z',
        'revision': 1,
      };

  String? get account {
    final t = token;
    if (t == null) return null;
    final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(t.split('.')[1]))));
    return payload['sub'] as String;
  }

  @override
  Future<void> setToken(String token) async {
    this.token = token;
    await super.setToken(token);
  }

  @override
  Future<void> clearToken() async {
    token = null;
    await super.clearToken();
  }

  @override
  Future<bool> hasToken() async {
    // After an app restart the token is only in secure storage.
    token ??= await const FlutterSecureStorage().read(key: 'access_token');
    return token != null && await super.hasToken();
  }

  Future<void> _gate(Completer<void>? gate) async {
    if (gate == null) return;
    if (!requestArrived.isCompleted) requestArrived.complete();
    await gate.future;
  }

  Response ok(String path, Object? data) => Response(requestOptions: RequestOptions(path: path), data: data, statusCode: 200);

  @override
  Future<Response> post(String path, {dynamic data}) async {
    if (path == '/auth/login') {
      final email = (data as Map)['email'] as String;
      final id = email.startsWith('a@') ? 'user-a' : 'user-b';
      return ok(path, {
        'accessToken': fakeJwt(id),
        'refreshToken': 'refresh-$id',
        'user': {'id': id, 'email': email, 'name': id == 'user-a' ? 'Account A' : 'Account B'},
      });
    }
    requests.add((account, path));
    if (path == '/sync/push') {
      final who = account ?? 'anonymous';
      final body = Map<String, dynamic>.from(data as Map);
      pushesBy.putIfAbsent(who, () => []).add(body);
      final gate = pushGate;
      pushGate = null;
      await _gate(gate);
      return ok(path, {
        'protocol': 2,
        'results': [
          for (final (i, c) in (body['changes'] as List).indexed)
            {'index': i, 'change_id': (c as Map)['change_id'], 'status': 'applied', 'revision': 1},
        ],
      });
    }
    throw UnimplementedError(path);
  }

  @override
  Future<Response> get(String path, {Map<String, dynamic>? queryParameters, bool useCache = true}) async {
    final who = account;
    requests.add((who, path));
    if (who == null) {
      throw DioException(
        requestOptions: RequestOptions(path: path),
        response: Response(requestOptions: RequestOptions(path: path), statusCode: 401),
      );
    }
    if (path == '/clients') return ok(path, {'data': []});
    if (path.startsWith('/sync/conflicts/')) {
      final id = path.substring('/sync/conflicts/'.length);
      final status = conflictStatus[id];
      if (status == null) {
        throw DioException(
          requestOptions: RequestOptions(path: path),
          response: Response(requestOptions: RequestOptions(path: path), statusCode: 404),
        );
      }
      return ok(path, {'id': id, 'status': status});
    }
    if (path == '/sync/pull') {
      final cursor = queryParameters?['cursor'] as String?;
      pullCursorsBy.putIfAbsent(who, () => []).add(cursor);
      final gate = pullGate;
      pullGate = null;
      await _gate(gate);
      return ok(path, {
        'protocol': 2,
        // A full pull (no cursor) returns the account's records.
        'clients': cursor == null ? records[who] : [],
        'invoices': [],
        'invoiceItems': [],
        'attachments': [],
        'tombstones': [],
        'fullResyncRequired': false,
        'openConflicts': 0,
        'lastSyncTimestamp': '2026-10-30T12:00:00.000Z',
        'cursor': 'cursor-of-$who',
        'hasMore': false,
      });
    }
    throw UnimplementedError(path);
  }

  List<String> pushedObjectIds(String account) => [
        for (final body in pushesBy[account] ?? const <Map<String, dynamic>>[])
          for (final c in body['changes'] as List) (c as Map)['object_id'] as String,
      ];
}

