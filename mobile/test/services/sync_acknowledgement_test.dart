// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Local imports - Core
import 'package:invoiceme/core/services/sync_service.dart';

void main() {
  group('acknowledgedChangeIds', () {
    final pending = <Map<String, Object?>>[
      for (final id in ['c0', 'c1', 'c2']) {'id': id, 'object_type': 'client', 'object_id': 'o-$id'},
    ];

    test('uses per-change results: a failure in the middle stays pending', () {
      final result = {
        'synced': 2,
        'failed': 1,
        'results': [
          {'index': 0, 'status': 'applied'},
          {'index': 1, 'status': 'failed'},
          {'index': 2, 'status': 'applied'},
        ],
      };

      expect(acknowledgedChangeIds(pending, result), ['c0', 'c2']);
    });

    test('acknowledges duplicates (already applied by an earlier push)', () {
      final result = {
        'synced': 3,
        'failed': 0,
        'results': [
          {'index': 0, 'status': 'duplicate'},
          {'index': 1, 'status': 'duplicate'},
          {'index': 2, 'status': 'applied'},
        ],
      };

      expect(acknowledgedChangeIds(pending, result), ['c0', 'c1', 'c2']);
    });

    test('keeps unknown statuses and out-of-range indexes pending', () {
      final result = {
        'synced': 1,
        'failed': 0,
        'results': [
          {'index': 0, 'status': 'conflict'},
          {'index': 7, 'status': 'applied'},
          {'index': 2, 'status': 'applied'},
        ],
      };

      expect(acknowledgedChangeIds(pending, result), ['c2']);
    });

    test('acknowledges merged changes', () {
      final result = {
        'results': [
          {'index': 0, 'status': 'merged', 'revision': 3},
        ],
      };
      expect(acknowledgedChangeIds(pending, result), ['c0']);
    });

    test('acknowledges nothing for servers without results (no protocol 2)', () {
      expect(acknowledgedChangeIds(pending, {'synced': 2, 'failed': 1}), isEmpty);
    });
  });

  group('ChangeObject.toJson', () {
    ChangeObject change({String? changeId, int? baseRevision, ChangeType type = ChangeType.update}) => ChangeObject(
          changeId: changeId,
          baseRevision: baseRevision,
          objectType: ChangeObjectType.client,
          objectId: 'o1',
          changeType: type,
          data: {'name': 'Acme'},
          deviceId: 'd1',
          updatedAt: '2026-10-25T10:00:00.000',
        );

    test('sends change_id when set', () {
      expect(change(changeId: 'c1').toJson()['change_id'], 'c1');
    });

    test('omits change_id when not set', () {
      expect(change().toJson().containsKey('change_id'), isFalse);
    });

    test('sends base_revision for update, never for create', () {
      expect(change(baseRevision: 2).toJson()['base_revision'], 2);
      expect(change(baseRevision: 2, type: ChangeType.create).toJson().containsKey('base_revision'), isFalse);
    });
  });
}
