// Flutter imports
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

// Local imports
import 'package:invoiceme/core/services/sync_conflicts_api.dart';
import 'package:invoiceme/core/services/sync_protocol.dart';
import 'package:invoiceme/models/sync_conflict.dart';
import 'package:invoiceme/screens/sync_conflicts_screen.dart';

Map<String, dynamic> conflictJson({
  String id = 'k1',
  String kind = 'stale_edit',
  String changeType = 'update',
  List<String> actions = const ['apply_client', 'dismiss'],
  Map<String, dynamic> yours = const {'name': 'Acme Mobile', 'email': 'mobile@acme.test'},
  List<String> conflicting = const ['name'],
  List<String> omitted = const [],
  String status = 'open',
}) =>
    {
      'id': id,
      'object_type': 'client',
      'object_id': 'c1',
      'label': 'Client Acme',
      'kind': kind,
      'change_type': changeType,
      'status': status,
      'resolution': null,
      'explanation': 'This record was changed elsewhere after this device last synced.',
      'base_revision': 2,
      'server_revision': 3,
      'your_changes': yours,
      'server_version': {'name': 'Acme Web', 'email': 'web@acme.test'},
      'conflicting_fields': conflicting,
      'omitted_fields': omitted,
      'allowed_actions': status == 'open' ? actions : <String>[],
      'created_at': '2026-10-27T12:00:00.000Z',
      'resolved_at': null,
    };

Map<String, dynamic> detailJson(Map<String, dynamic> conflict, {int? revision = 3, bool deleted = false}) => {
      ...conflict,
      'current': {
        'revision': revision,
        'deleted': deleted,
        'fields': deleted ? null : {'name': 'Acme Web', 'email': 'web@acme.test'},
      },
    };

class FakeConflictsApi implements SyncConflictsApi {
  List<Map<String, dynamic>> list;
  Map<String, dynamic> detail;
  final calls = <String>[];
  final resolves = <({String id, String action, int? expected})>[];

  /// Errors thrown by the next resolve calls, in order.
  final resolveErrors = <SyncConflictsApiException>[];
  SyncConflictsApiException? getError;

  FakeConflictsApi({required this.list, required this.detail});

  @override
  Future<List<SyncConflict>> listOpen() async {
    calls.add('list');
    return list.map(SyncConflict.fromJson).toList();
  }

  @override
  Future<SyncConflictDetail> get(String id) async {
    calls.add('get:$id');
    if (getError != null) throw getError!;
    return SyncConflictDetail.fromJson(detail);
  }

  @override
  Future<SyncConflictDetail> resolve(String id, String action, {int? expectedRevision}) async {
    calls.add('resolve:$id:$action');
    resolves.add((id: id, action: action, expected: expectedRevision));
    if (resolveErrors.isNotEmpty) throw resolveErrors.removeAt(0);
    final resolved = Map<String, dynamic>.from(detail)
      ..['status'] = action == 'dismiss' ? 'dismissed' : 'resolved'
      ..['resolution'] = action
      ..['allowed_actions'] = <String>[];
    detail = resolved;
    return SyncConflictDetail.fromJson(resolved);
  }
}

class FakeFailedStore implements FailedChangesStore {
  final List<FailedChange> rows;
  final discarded = <String>[];

  FakeFailedStore(this.rows);

  @override
  Future<List<FailedChange>> listFailed() async => List.of(rows);

  @override
  Future<void> discard(String id) async {
    discarded.add(id);
    rows.removeWhere((r) => r.id == id);
  }
}

Future<void> pumpDetail(WidgetTester tester, FakeConflictsApi api) async {
  await tester.pumpWidget(MaterialApp(home: SyncConflictDetailScreen(api: api, conflictId: 'k1')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('list shows label, kind, explanation and opens the detail', (tester) async {
    final c = conflictJson();
    final api = FakeConflictsApi(list: [c], detail: detailJson(c));
    await tester.pumpWidget(MaterialApp(home: SyncConflictsScreen(api: api)));
    await tester.pumpAndSettle();

    expect(find.text('Client Acme'), findsOneWidget);
    expect(find.textContaining('Edited in two places'), findsOneWidget);
    expect(find.textContaining('changed elsewhere'), findsOneWidget);

    await tester.tap(find.text('Client Acme'));
    await tester.pumpAndSettle();
    expect(api.calls, contains('get:k1'));
    expect(find.text('What happened'), findsOneWidget);
  });

  testWidgets('empty list says there is nothing to review', (tester) async {
    final api = FakeConflictsApi(list: [], detail: {});
    await tester.pumpWidget(MaterialApp(home: SyncConflictsScreen(api: api)));
    await tester.pumpAndSettle();
    expect(find.text('No sync conflicts to review.'), findsOneWidget);
  });

  testWidgets('detail shows both versions and only the allowed actions', (tester) async {
    final c = conflictJson(omitted: ['notes']);
    final api = FakeConflictsApi(list: [c], detail: detailJson(c));
    await pumpDetail(tester, api);

    expect(find.text('Your version'), findsOneWidget);
    expect(find.text('Current version'), findsOneWidget);
    expect(find.text('Acme Mobile'), findsOneWidget);
    expect(find.text('Acme Web'), findsOneWidget);
    expect(find.text('mobile@acme.test'), findsOneWidget);
    expect(find.text('web@acme.test'), findsOneWidget);
    expect(find.textContaining('Highlighted'), findsOneWidget);
    expect(find.textContaining('Not shown: notes'), findsOneWidget);

    expect(find.text('Keep current version'), findsOneWidget);
    expect(find.text('Use my version'), findsOneWidget);
    expect(find.text('Restore'), findsNothing);
  });

  testWidgets('protected invoice: only dismiss is offered', (tester) async {
    final c = conflictJson(kind: 'protected_invoice', actions: ['dismiss']);
    final api = FakeConflictsApi(list: [c], detail: detailJson(c));
    await pumpDetail(tester, api);
    expect(find.text('Keep current version'), findsOneWidget);
    expect(find.text('Use my version'), findsNothing);
    expect(find.text('Restore'), findsNothing);
  });

  testWidgets('dismiss sends expected_revision = current.revision', (tester) async {
    final c = conflictJson();
    final api = FakeConflictsApi(list: [c], detail: detailJson(c, revision: 3));
    await pumpDetail(tester, api);
    await tester.tap(find.text('Keep current version'));
    await tester.pumpAndSettle();
    expect(api.resolves.single, (id: 'k1', action: 'dismiss', expected: 3));
    expect(find.text('Use my version'), findsNothing);
    expect(find.textContaining('Resolved'), findsOneWidget);
  });

  testWidgets('use my version sends apply_client with expected_revision', (tester) async {
    final c = conflictJson();
    final api = FakeConflictsApi(list: [c], detail: detailJson(c, revision: 5));
    await pumpDetail(tester, api);
    await tester.tap(find.text('Use my version'));
    await tester.pumpAndSettle();
    expect(api.resolves.single, (id: 'k1', action: 'apply_client', expected: 5));
  });

  testWidgets('restore of a deleted record sends restore with expected_revision', (tester) async {
    final c = conflictJson(
      kind: 'delete_after_edit',
      changeType: 'delete',
      actions: ['restore', 'dismiss'],
      yours: {},
      conflicting: [],
    );
    final api = FakeConflictsApi(list: [c], detail: detailJson(c, revision: 4, deleted: true));
    await pumpDetail(tester, api);
    expect(find.text('The record is currently deleted.'), findsOneWidget);
    expect(find.text('Use my version'), findsNothing);
    await tester.tap(find.text('Restore'));
    await tester.pumpAndSettle();
    expect(api.resolves.single, (id: 'k1', action: 'restore', expected: 4));
  });

  testWidgets('409 reloads the conflict and says the record changed', (tester) async {
    final c = conflictJson();
    final api = FakeConflictsApi(list: [c], detail: detailJson(c, revision: 3));
    api.resolveErrors.add(const SyncConflictsApiException(409, 'The record changed', currentRevision: 4));
    await pumpDetail(tester, api);

    api.detail = detailJson(c, revision: 4);
    await tester.tap(find.text('Use my version'));
    await tester.pumpAndSettle();

    expect(find.textContaining('The record changed since you opened this conflict'), findsOneWidget);
    expect(api.calls.where((call) => call == 'get:k1').length, 2);

    // The next attempt uses the reloaded revision.
    await tester.tap(find.text('Use my version'));
    await tester.pumpAndSettle();
    expect(api.resolves.last, (id: 'k1', action: 'apply_client', expected: 4));
  });

  testWidgets('422 shows the server message', (tester) async {
    final c = conflictJson();
    final api = FakeConflictsApi(list: [c], detail: detailJson(c));
    api.resolveErrors.add(const SyncConflictsApiException(422, 'This invoice is sent or paid; edit it directly instead'));
    await pumpDetail(tester, api);
    await tester.tap(find.text('Use my version'));
    await tester.pumpAndSettle();
    expect(find.text('This invoice is sent or paid; edit it directly instead'), findsOneWidget);
  });

  testWidgets('404 shows that the conflict is gone', (tester) async {
    final c = conflictJson();
    final api = FakeConflictsApi(list: [c], detail: detailJson(c));
    api.getError = const SyncConflictsApiException(404, 'Conflict not found');
    await pumpDetail(tester, api);
    expect(find.text('This conflict no longer exists.'), findsOneWidget);
    expect(find.text('Use my version'), findsNothing);
  });

  testWidgets('changes that could not be synced: listed with plain reason, discard after confirmation', (tester) async {
    final c = conflictJson();
    final api = FakeConflictsApi(list: [c], detail: detailJson(c));
    final store = FakeFailedStore([
      const FailedChange(
        id: 'p1',
        objectType: 'client',
        objectId: 'abcdef1234',
        changeType: 'update',
        reason: 'not_found',
        attempts: 1,
      ),
    ]);
    await tester.pumpWidget(MaterialApp(home: SyncConflictsScreen(api: api, failedChanges: store)));
    await tester.pumpAndSettle();

    expect(find.text('Client Acme'), findsOneWidget);
    expect(find.text('Changes that could not be synced'), findsOneWidget);
    expect(find.text('Client abcdef12 (update)'), findsOneWidget);
    expect(find.text('The record does not exist on the server.'), findsOneWidget);

    await tester.tap(find.text('Discard this change'));
    await tester.pumpAndSettle();
    expect(find.text('Discard this change?'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(store.discarded, isEmpty);

    await tester.tap(find.text('Discard this change'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Discard'));
    await tester.pumpAndSettle();
    expect(store.discarded, ['p1']);
    expect(find.text('Changes that could not be synced'), findsNothing);
  });

  testWidgets('failed changes are shown even when the conflicts API fails', (tester) async {
    final api = FakeConflictsApi(list: [], detail: {});
    final store = FakeFailedStore([
      const FailedChange(id: 'p1', objectType: 'invoice', objectId: 'i1', changeType: 'delete', reason: 'record_deleted'),
    ]);
    await tester.pumpWidget(MaterialApp(home: SyncConflictsScreen(api: _FailingApi(api), failedChanges: store)));
    await tester.pumpAndSettle();
    expect(find.text('offline'), findsOneWidget);
    expect(find.text('Invoice i1 (delete)'), findsOneWidget);
  });
}

class _FailingApi implements SyncConflictsApi {
  final SyncConflictsApi inner;
  _FailingApi(this.inner);

  @override
  Future<List<SyncConflict>> listOpen() async => throw const SyncConflictsApiException(null, 'offline');

  @override
  Future<SyncConflictDetail> get(String id) => inner.get(id);

  @override
  Future<SyncConflictDetail> resolve(String id, String action, {int? expectedRevision}) =>
      inner.resolve(id, action, expectedRevision: expectedRevision);
}
