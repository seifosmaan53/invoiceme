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
  int attempts = 0,
  String? parentId,
  int? parentBase,
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
      'attempts': attempts,
      'parent_id': parentId,
      'parent_base_revision': parentBase,
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
        PushActionKind.giveUp,
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

  group('parent_revision (invoice items)', () {
    test('present for item create, update and delete when known', () {
      for (final change in ['create', 'update', 'delete']) {
        final json = pendingRowToChange(
          row('i-$change', type: 'invoice_item', change: change, base: 2, parentId: 'inv', parentBase: 5),
        );
        expect(json['parent_revision'], 5, reason: change);
      }
    });

    test('absent for items when unknown, and for other object types', () {
      expect(pendingRowToChange(row('i', type: 'invoice_item', parentId: 'inv')).containsKey('parent_revision'), isFalse);
      expect(pendingRowToChange(row('c', type: 'client', parentBase: 5)).containsKey('parent_revision'), isFalse);
      expect(pendingRowToChange(row('v', type: 'invoice', parentBase: 5)).containsKey('parent_revision'), isFalse);
    });

    test('item data names its invoice (create or move)', () {
      expect(itemInvoiceIdFromData({'invoiceId': 'inv-2', 'quantity': 1}), 'inv-2');
      expect(itemInvoiceIdFromData({'quantity': 1}), isNull);
    });

    test('an item change waits while a change of its invoice is in the batch', () {
      final rows = [
        row('v1', type: 'invoice', objectId: 'inv', base: 3),
        row('i1', type: 'invoice_item', objectId: 'it1', parentId: 'inv', parentBase: 3),
        row('i2', type: 'invoice_item', objectId: 'it1', parentId: 'inv', parentBase: 3),
        row('j1', type: 'invoice_item', objectId: 'it2', parentId: 'other', parentBase: 1),
      ];
      expect(selectPushBatch(rows).map((r) => r['id']), ['v1', 'j1']);
    });

    for (final status in ['applied', 'merged']) {
      test('$status invoice result moves queued item changes on the same invoice version', () {
        final invoice = row('v1', type: 'invoice', objectId: 'inv', base: 3);
        final later = [
          invoice,
          row('i1', type: 'invoice_item', objectId: 'it1', parentId: 'inv', parentBase: 3),
          row('i2', type: 'invoice_item', objectId: 'it2', parentId: 'inv', parentBase: 2),
          row('i3', type: 'invoice_item', objectId: 'it3', parentId: 'other', parentBase: 3),
          row('i4', type: 'invoice_item', objectId: 'it4', parentId: 'inv', parentBase: 3, status: 'failed'),
        ];
        final plan = planPushResults([invoice], {
          'results': [
            {'index': 0, 'change_id': 'v1', 'status': status, 'revision': 4},
          ],
        });
        expect(rebasedParentRevisions(plan.actions.single, invoice, later), {'i1': 4});
      });
    }

    test('items of a newly created invoice get its first revision', () {
      final invoice = row('v1', type: 'invoice', objectId: 'inv', change: 'create');
      final item = row('i1', type: 'invoice_item', objectId: 'it1', change: 'create', parentId: 'inv');
      final plan = planPushResults([invoice], {
        'results': [
          {'index': 0, 'change_id': 'v1', 'status': 'applied', 'revision': 1},
        ],
      });
      expect(rebasedParentRevisions(plan.actions.single, invoice, [invoice, item]), {'i1': 1});
    });

    test('client results and conflicts do not move parent revisions', () {
      final invoice = row('v1', type: 'invoice', objectId: 'inv', base: 3);
      final item = row('i1', type: 'invoice_item', objectId: 'it1', parentId: 'inv', parentBase: 3);
      final plan = planPushResults([invoice], {
        'results': [
          {'index': 0, 'change_id': 'v1', 'status': 'conflict', 'conflict_id': 'k'},
        ],
      });
      expect(rebasedParentRevisions(plan.actions.single, invoice, [item]), isEmpty);
    });
  });

  group('rebase of rows already sent (new change_id)', () {
    test('reviewer scenario: item before its invoice in one batch, item failed, invoice applied', () {
      final item = row('i1', type: 'invoice_item', objectId: 'it1', base: 2, parentId: 'inv', parentBase: 3);
      final invoice = row('v1', type: 'invoice', objectId: 'inv', base: 3);
      final batch = selectPushBatch([item, invoice]);
      expect(batch.map((r) => r['id']), ['i1', 'v1']);

      final plan = planPushResults(batch, {
        'results': [
          {'index': 0, 'change_id': 'i1', 'status': 'failed', 'reason': 'rejected'},
          {'index': 1, 'change_id': 'v1', 'status': 'applied', 'revision': 4},
        ],
      });
      // As stored after the round: the item failed (not applied).
      final itemNow = {...item, 'last_result': sentFailed, 'attempts': plan.actions[0].attempts};
      final updates = planRebases([(plan.actions[1], invoice)], [itemNow]);
      expect(updates.single.rowId, 'i1');
      expect(updates.single.values, {'parent_base_revision': 4});
      expect(updates.single.newChangeId, isTrue);

      // The resend carries the new parent_revision under a new change_id.
      final resent = {...itemNow, ...updates.single.values, 'id': 'i1-new', 'last_result': null};
      final change = pendingRowToChange(resent);
      expect(change['change_id'], 'i1-new');
      expect(change['parent_revision'], 4);
    });

    test('never-sent rows keep their change_id', () {
      final invoice = row('v1', type: 'invoice', objectId: 'inv', base: 3);
      final item = row('i1', type: 'invoice_item', objectId: 'it1', parentId: 'inv', parentBase: 3);
      final plan = planPushResults([invoice], {
        'results': [
          {'index': 0, 'change_id': 'v1', 'status': 'applied', 'revision': 4},
        ],
      });
      final u = planRebases([(plan.actions.single, invoice)], [item]).single;
      expect((u.rowId, u.newChangeId), ('i1', false));
    });

    test('base_revision rebase of a sent-and-failed row also gets a new change_id', () {
      final first = row('a1', objectId: 'A', base: 3);
      final later = {...row('a2', objectId: 'A', base: 3), 'last_result': sentFailed};
      final plan = planPushResults([first], {
        'results': [
          {'index': 0, 'change_id': 'a1', 'status': 'applied', 'revision': 4},
        ],
      });
      final u = planRebases([(plan.actions.single, first)], [later]).single;
      expect(u.values, {'base_revision': 4});
      expect(u.newChangeId, isTrue);
    });

    test('rows whose last send has no result are not rebased', () {
      final invoice = row('v1', type: 'invoice', objectId: 'inv', base: 3);
      final item = {
        ...row('i1', type: 'invoice_item', objectId: 'it1', parentId: 'inv', parentBase: 3),
        'last_result': sentUnknown,
      };
      final plan = planPushResults([invoice], {
        'results': [
          {'index': 0, 'change_id': 'v1', 'status': 'applied', 'revision': 4},
        ],
      });
      expect(planRebases([(plan.actions.single, invoice)], [item]), isEmpty);
    });
  });

  group('failed changes (give up)', () {
    Map<String, dynamic> failedWith(String id, String? reason) => {
          'results': [
            {'index': 0, 'change_id': id, 'status': 'failed', if (reason != null) 'reason': reason},
          ],
        };

    test('a retryable reason counts attempts and gives up at the third', () {
      var r = row('c', attempts: 0);
      var a = planPushResults([r], failedWith('c', 'open_conflict')).actions.single;
      expect((a.kind, a.attempts), (PushActionKind.keepPending, 1));
      r = row('c', attempts: 1);
      a = planPushResults([r], failedWith('c', 'open_conflict')).actions.single;
      expect((a.kind, a.attempts), (PushActionKind.keepPending, 2));
      r = row('c', attempts: 2);
      a = planPushResults([r], failedWith('c', 'open_conflict')).actions.single;
      expect((a.kind, a.attempts, a.reason), (PushActionKind.giveUp, 3, 'open_conflict'));
    });

    test('non-retryable reasons give up at once', () {
      for (final reason in nonRetryableReasons) {
        final a = planPushResults([row('c')], failedWith('c', reason)).actions.single;
        expect(a.kind, PushActionKind.giveUp, reason: reason);
        expect(a.attempts, 1);
      }
    });

    test('"rejected" is counted and given up at the third failure', () {
      final a1 = planPushResults([row('c')], failedWith('c', 'rejected')).actions.single;
      expect((a1.kind, a1.attempts), (PushActionKind.keepPending, 1));
      final a3 = planPushResults([row('c', attempts: 2)], failedWith('c', 'rejected')).actions.single;
      expect((a3.kind, a3.attempts), (PushActionKind.giveUp, 3));
      expect(failureReasonText('rejected'), contains('refused'));
    });

    test('a failure counts at most once per sync (later rounds do not count)', () {
      final a = planPushResults([row('c', attempts: 2)], failedWith('c', 'rejected'), countedThisSync: {'c'}).actions.single;
      expect((a.kind, a.attempts), (PushActionKind.keepPending, 2));
      // A non-retryable reason still gives up at once.
      final b = planPushResults([row('c', attempts: 1)], failedWith('c', 'not_found'), countedThisSync: {'c'}).actions.single;
      expect(b.kind, PushActionKind.giveUp);
    });

    test('failed without a reason (older server, server error) is not counted', () {
      final a = planPushResults([row('c', attempts: 2)], failedWith('c', null)).actions.single;
      expect((a.kind, a.attempts), (PushActionKind.keepPending, 2));
    });

    test('a given-up change blocks neither later changes of the record nor pull refreshes', () {
      final rows = [row('a1', objectId: 'A', status: 'failed'), row('a2', objectId: 'A')];
      expect(selectPushBatch(rows).map((r) => r['id']), ['a2']);
      expect(pendingObjectKeys([row('a1', objectId: 'A', status: 'failed')]), isEmpty);
    });

    test('after a give-up or discard the next pull fetches everything', () {
      expect(pullSince('2026-10-28T00:00:00Z', fullPullNeeded: true), isNull);
      expect(pullSince('2026-10-28T00:00:00Z', fullPullNeeded: false), '2026-10-28T00:00:00Z');
    });

    test('failed change label and reason in plain words', () {
      final f = FailedChange.fromRow(row('x', type: 'invoice_item', objectId: '1a2b3c4d-9999', status: 'failed')
        ..['last_reason'] = 'record_deleted');
      expect(f.label, 'Invoice item 1a2b3c4d (update)');
      expect(f.reasonText, 'The record was deleted on the server.');
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
