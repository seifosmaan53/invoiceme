// Flutter imports
import 'package:flutter_test/flutter_test.dart';

// Local imports - Core
import '../../lib/core/services/sync_service.dart';

void main() {
  group('acknowledgedChangeIds', () {
    final pending = <Map<String, Object?>>[
      {'id': 'c0'},
      {'id': 'c1'},
      {'id': 'c2'},
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

    test('falls back to the first `synced` changes for servers without results', () {
      expect(acknowledgedChangeIds(pending, {'synced': 2, 'failed': 1}), ['c0', 'c1']);
    });
  });

  group('ChangeObject.toJson', () {
    ChangeObject change({String? changeId}) => ChangeObject(
          changeId: changeId,
          objectType: ChangeObjectType.client,
          objectId: 'o1',
          changeType: ChangeType.update,
          data: {'name': 'Acme'},
          deviceId: 'd1',
          updatedAt: '2026-10-25T10:00:00.000',
        );

    test('sends change_id when set', () {
      expect(change(changeId: 'c1').toJson()['change_id'], 'c1');
    });

    test('omits change_id when not set (format accepted by older servers)', () {
      expect(change().toJson().containsKey('change_id'), isFalse);
    });
  });
}
