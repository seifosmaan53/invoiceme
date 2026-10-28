// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Local imports
import 'package:invoiceme/core/services/sync_protocol.dart';
import 'package:invoiceme/models/client.dart';
import 'package:invoiceme/models/invoice.dart';
import 'package:invoiceme/models/invoice_item.dart';

Map<String, Object?> row(
  String id, {
  String type = 'client',
  String objectId = 'o1',
  String change = 'update',
  int? base,
  String data = '{"name":"Acme"}',
  String status = 'pending',
  int synced = 0,
}) =>
    {
      'id': id,
      'object_type': type,
      'object_id': objectId,
      'change_type': change,
      'change_json': data,
      'device_id': 'd1',
      'created_at': '2026-10-28T10:00:00.000',
      'base_revision': base,
      'status': status,
      'synced': synced,
    };

void main() {
  group('push request (protocol 2)', () {
    test('body carries protocol 2, deviceId and change_id per change', () {
      final body = buildPushBody('dev-1', [row('c1', base: 3)]);
      expect(body['protocol'], 2);
      expect(body['deviceId'], 'dev-1');
      final change = (body['changes'] as List).single as Map;
      expect(change['change_id'], 'c1');
      expect(change['object_type'], 'client');
      expect(change['data'], {'name': 'Acme'});
    });

    test('base_revision present for update and delete', () {
      expect(pendingRowToChange(row('u', change: 'update', base: 4))['base_revision'], 4);
      expect(pendingRowToChange(row('d', change: 'delete', base: 7, data: '{}'))['base_revision'], 7);
    });

    test('base_revision absent for create, even if the row has one', () {
      final change = pendingRowToChange(row('c', change: 'create', base: 2));
      expect(change.containsKey('base_revision'), isFalse);
      expect(change['change_id'], 'c');
    });

    test('changedFields keeps only changed values (deep compare)', () {
      final previous = {'name': 'Acme', 'email': 'a@x.com', 'address': {'city': 'NY'}, 'tags': ['a']};
      final next = {'name': 'Acme', 'email': 'b@x.com', 'address': {'city': 'NY'}, 'tags': ['a', 'b'], 'notes': 'n'};
      expect(changedFields(previous, next), {'email': 'b@x.com', 'tags': ['a', 'b'], 'notes': 'n'});
      expect(changedFields(previous, previous), isEmpty);
    });

    test('batch: pending only, one change per record, queue order kept', () {
      final rows = [
        row('a1', objectId: 'A'),
        row('b1', objectId: 'B'),
        row('a2', objectId: 'A'),
        row('c1', objectId: 'C', status: 'conflict'),
        row('d1', objectId: 'D', synced: 1),
        row('i1', type: 'invoice', objectId: 'A'),
      ];
      expect(selectPushBatch(rows).map((r) => r['id']), ['a1', 'b1', 'i1']);
    });
  });

  group('push results', () {
    final sent = [
      row('c0', objectId: 'o0'),
      row('c1', objectId: 'o1'),
      row('c2', objectId: 'o2'),
      row('c3', objectId: 'o3'),
      row('c4', objectId: 'o4'),
    ];

    test('applied / merged / duplicate / conflict / failed map to local actions', () {
      final plan = planPushResults(sent, {
        'protocol': 2,
        'synced': 3,
        'failed': 2,
        'results': [
          {'index': 0, 'change_id': 'c0', 'status': 'applied', 'revision': 5},
          {'index': 1, 'change_id': 'c1', 'status': 'merged', 'revision': 9},
          {'index': 2, 'change_id': 'c2', 'status': 'duplicate'},
          {'index': 3, 'change_id': 'c3', 'status': 'conflict', 'conflict_id': 'k3'},
          {'index': 4, 'change_id': 'c4', 'status': 'failed', 'reason': 'invalid_base_revision'},
        ],
      });
      final a = plan.actions;
      expect(a.map((x) => x.kind), [
        PushActionKind.synced,
        PushActionKind.synced,
        PushActionKind.synced,
        PushActionKind.conflict,
        PushActionKind.keepPending,
      ]);
      expect(a[0].revision, 5);
      expect(a[1].revision, 9);
      expect(a[2].revision, isNull);
      expect(a[3].conflictId, 'k3');
      expect(a[4].reason, 'invalid_base_revision');
      expect(plan.state, SyncState.ok);
      expect(plan.resultsMissing, isFalse);
    });

    test('a delete applied with a conflict_id (delete_after_edit) is synced', () {
      final plan = planPushResults([row('d', change: 'delete', base: 1)], {
        'results': [
          {'index': 0, 'change_id': 'd', 'status': 'applied', 'conflict_id': 'k'},
        ],
      });
      expect(plan.actions.single.kind, PushActionKind.synced);
      expect(plan.actions.single.conflictId, 'k');
    });

    test('failed client_upgrade_required asks for an app update', () {
      final plan = planPushResults([sent[0]], {
        'results': [
          {'index': 0, 'change_id': 'c0', 'status': 'failed', 'reason': 'client_upgrade_required'},
        ],
      });
      expect(plan.actions.single.kind, PushActionKind.keepPending);
      expect(plan.state, SyncState.appUpdateRequired);
      expect(syncStateMessage(plan.state), contains('Update the app'));
    });

    test('notice client_upgrade_required asks for an app update', () {
      final plan = planPushResults([sent[0]], {
        'notice': 'client_upgrade_required',
        'message': 'Update the app to sync',
        'results': [
          {'index': 0, 'change_id': 'c0', 'status': 'failed'},
        ],
      });
      expect(plan.state, SyncState.appUpdateRequired);
      expect(plan.message, 'Update the app to sync');
    });

    test('old-format response (only counts, no results) marks nothing, no conflicts', () {
      final plan = planPushResults(sent, {'synced': 5, 'failed': 0});
      expect(plan.resultsMissing, isTrue);
      expect(plan.actions.every((a) => a.kind == PushActionKind.keepPending), isTrue);
      expect(plan.count(PushActionKind.conflict), 0);
      expect(plan.count(PushActionKind.synced), 0);
      expect(plan.state, SyncState.serverUpdateRequired);
      expect(syncStateMessage(plan.state), contains('Sync needs a server update'));
    });

    test('missing, out-of-range or mismatched results stay pending', () {
      final plan = planPushResults(sent.sublist(0, 3), {
        'results': [
          {'index': 0, 'change_id': 'other', 'status': 'applied'},
          {'index': 9, 'change_id': 'c1', 'status': 'applied'},
          {'index': 2, 'status': 'something_new'},
        ],
      });
      expect(plan.actions.map((a) => a.kind), everyElement(PushActionKind.keepPending));
    });

    test('rebase: applied with revision moves later rows of the same record on the same base', () {
      final first = row('a1', objectId: 'A', base: 3);
      final later = [
        first,
        row('a2', objectId: 'A', base: 3),
        row('a3', objectId: 'A', base: 2),
        row('b1', objectId: 'B', base: 3),
        row('a4', objectId: 'A', change: 'create'),
      ];
      final plan = planPushResults([first], {
        'results': [
          {'index': 0, 'change_id': 'a1', 'status': 'applied', 'revision': 4},
        ],
      });
      expect(rebasedBaseRevisions(plan.actions.single, first, later), {'a2': 4});
    });

    test('rebase: create then update (update queued without base)', () {
      final create = row('c', objectId: 'N', change: 'create');
      final update = row('u', objectId: 'N');
      final plan = planPushResults([create], {
        'results': [
          {'index': 0, 'change_id': 'c', 'status': 'applied', 'revision': 1},
        ],
      });
      expect(rebasedBaseRevisions(plan.actions.single, create, [create, update]), {'u': 1});
    });

    test('rebase: merged does not move later rows (server compares them again)', () {
      final first = row('a1', objectId: 'A', base: 3);
      final plan = planPushResults([first], {
        'results': [
          {'index': 0, 'change_id': 'a1', 'status': 'merged', 'revision': 6},
        ],
      });
      expect(rebasedBaseRevisions(plan.actions.single, first, [row('a2', objectId: 'A', base: 3)]), isEmpty);
    });
  });

  group('pull', () {
    test('tombstones delete local rows; an invoice also removes its items and attachments', () {
      final deletes = tombstoneDeletes([
        {'object_type': 'client', 'object_id': 'c1', 'deleted_at': 'x'},
        {'object_type': 'invoice', 'object_id': 'i1', 'deleted_at': 'x'},
        {'object_type': 'invoice_item', 'object_id': 'it1', 'deleted_at': 'x'},
        {'object_type': 'attachment', 'object_id': 'at1', 'deleted_at': 'x'},
        {'object_type': 'unknown', 'object_id': 'z', 'deleted_at': 'x'},
        'garbage',
      ]);
      expect(deletes, [
        const LocalDelete('clients_local', 'id = ?', ['c1']),
        const LocalDelete('invoice_items_local', 'invoice_id = ?', ['i1']),
        const LocalDelete('attachments_local', 'owner_type = ? AND owner_id = ?', ['invoice', 'i1']),
        const LocalDelete('invoices_local', 'id = ?', ['i1']),
        const LocalDelete('invoice_items_local', 'id = ?', ['it1']),
        const LocalDelete('attachments_local', 'id = ?', ['at1']),
      ]);
    });

    test('no tombstones (older server) => no deletes', () {
      expect(tombstoneDeletes(null), isEmpty);
    });

    test('fullResyncRequired with since => full resync; never loops on a full pull', () {
      expect(pullStep({'fullResyncRequired': true}, sentSince: true), PullStep.fullResync);
      expect(pullStep({'fullResyncRequired': true}, sentSince: false), PullStep.apply);
      expect(pullStep({'fullResyncRequired': false}, sentSince: true), PullStep.apply);
      expect(pullStep({}, sentSince: true), PullStep.apply);
    });

    test('openConflicts is read, 0 when absent', () {
      expect(openConflictsOf({'openConflicts': 3}), 3);
      expect(openConflictsOf({}), 0);
    });

    test('records with a pending (not conflict, not synced) change are protected from pull', () {
      final keys = pendingObjectKeys([
        row('1', objectId: 'A'),
        row('2', objectId: 'B', status: 'conflict'),
        row('3', objectId: 'C', synced: 1),
        row('4', type: 'invoice', objectId: 'A'),
      ]);
      expect(keys, {'client:A', 'invoice:A'});
    });
  });

  group('models keep revision', () {
    test('client', () {
      final c = Client.fromJson({
        'id': 'c1',
        'userId': 'u1',
        'name': 'Acme',
        'createdAt': '2026-10-01T00:00:00Z',
        'updatedAt': '2026-10-01T00:00:00Z',
        'revision': 4,
      });
      expect(c.revision, 4);
      expect(c.toDatabaseMap()['revision'], 4);
      expect(Client.fromDatabaseMap(c.toDatabaseMap()).revision, 4);
    });

    test('invoice and item', () {
      final inv = Invoice.fromJson({'id': 'i1', 'clientId': 'c1', 'number': 'INV-1', 'revision': '7'});
      expect(inv.revision, 7);
      expect(Invoice.fromDatabaseMap(inv.toDatabaseMap()).revision, 7);
      final item = InvoiceItem.fromJson({
        'id': 'it1',
        'invoiceId': 'i1',
        'description': 'Work',
        'quantity': '1',
        'unitPrice': '10',
        'createdAt': '2026-10-01T00:00:00Z',
        'revision': 2,
      });
      expect(InvoiceItem.fromDatabaseMap(item.toDatabaseMap()).revision, 2);
    });

    test('a record without revision (older server) stays null', () {
      final c = Client.fromJson({
        'id': 'c1',
        'userId': 'u1',
        'name': 'Acme',
        'createdAt': '2026-10-01T00:00:00Z',
        'updatedAt': '2026-10-01T00:00:00Z',
      });
      expect(c.revision, isNull);
      expect(c.toJson().containsKey('revision'), isFalse);
    });
  });
}
