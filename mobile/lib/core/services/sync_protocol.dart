/// Sync protocol 2 (docs/SYNC-CONTRACT.md): the pure parts of the client.
///
/// Everything here works on plain maps (pending_changes rows and decoded
/// server responses) so it can be tested without a database or a network.
/// SyncService applies the results to SQLite.
library;

import 'dart:convert';

/// Value of `protocol` in every push body.
const int syncProtocolVersion = 2;

/// `reason` / `notice` the server uses when this app must be updated.
const String upgradeRequiredReason = 'client_upgrade_required';

/// Shown when the server refuses the app version (`client_upgrade_required`).
const String appUpdateRequiredMessage =
    'This version of the app can no longer send changes. Update the app to sync; your data can still be viewed.';

/// Shown when the server does not speak protocol 2 (it answered the push with
/// 400, or without per-change results). Nothing was sent; the queue is kept.
const String serverUpdateRequiredMessage =
    'Sync needs a server update. Your offline changes are kept on this device and will be sent once the server is updated.';

/// pending_changes.status values.
const String pendingStatus = 'pending';
const String conflictStatus = 'conflict';

/// Object types that have a server revision (attachments do not).
const Set<String> versionedObjectTypes = {'client', 'invoice', 'invoice_item'};

/// Local cache table per sync object type.
const Map<String, String> localTableFor = {
  'client': 'clients_local',
  'invoice': 'invoices_local',
  'invoice_item': 'invoice_items_local',
  'attachment': 'attachments_local',
};

/// Overall sync state the UI shows (persisted as [SyncState.name]).
enum SyncState {
  ok,

  /// The server does not support protocol 2. Pushing is stopped, the queue kept.
  serverUpdateRequired,

  /// The server answered `client_upgrade_required`.
  appUpdateRequired,
}

SyncState syncStateFromName(String? name) =>
    SyncState.values.firstWhere((s) => s.name == name, orElse: () => SyncState.ok);

/// User-facing message for a [SyncState], or null when there is nothing to say.
String? syncStateMessage(SyncState state) {
  switch (state) {
    case SyncState.ok:
      return null;
    case SyncState.serverUpdateRequired:
      return serverUpdateRequiredMessage;
    case SyncState.appUpdateRequired:
      return appUpdateRequiredMessage;
  }
}

/// A revision as sent by the server (number, or a numeric string), else null.
int? parseRevision(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

/// The fields of [next] whose value differs from [previous] (deep compare).
/// An update carries only these.
Map<String, dynamic> changedFields(Map<String, dynamic> previous, Map<String, dynamic> next) {
  final changed = <String, dynamic>{};
  next.forEach((key, value) {
    if (!previous.containsKey(key) || jsonEncode(previous[key]) != jsonEncode(value)) {
      changed[key] = value;
    }
  });
  return changed;
}

/// One pending_changes row as a protocol-2 change.
///
/// `change_id` is the row id. `base_revision` is sent for update and delete
/// when the row has one, never for create.
Map<String, dynamic> pendingRowToChange(Map<String, Object?> row) {
  final changeType = row['change_type'] as String;
  final base = parseRevision(row['base_revision']);
  return {
    'change_id': row['id'] as String,
    if (changeType != 'create' && base != null) 'base_revision': base,
    'object_type': row['object_type'] as String,
    'object_id': row['object_id'] as String,
    'change_type': changeType,
    'data': jsonDecode(row['change_json'] as String),
    'device_id': row['device_id'] as String,
    'updated_at': row['created_at'] as String,
  };
}

/// The push request body for [rows] (already in send order).
Map<String, dynamic> buildPushBody(String deviceId, List<Map<String, Object?>> rows) => {
      'protocol': syncProtocolVersion,
      'deviceId': deviceId,
      'changes': rows.map(pendingRowToChange).toList(),
    };

/// The rows to send in one push: pending rows only, in queue order, and at
/// most one change per record.
///
/// A second change of the same record waits for the next round, after the
/// first one's new revision is known ([rebasedBaseRevisions]); sending both
/// with the same base would make the server compare the device against its
/// own earlier change.
List<Map<String, Object?>> selectPushBatch(List<Map<String, Object?>> rows) {
  final seen = <String>{};
  final batch = <Map<String, Object?>>[];
  for (final row in rows) {
    if ((row['status'] ?? pendingStatus) != pendingStatus) continue;
    if ((row['synced'] ?? 0) != 0) continue;
    final key = '${row['object_type']}:${row['object_id']}';
    if (seen.add(key)) batch.add(row);
  }
  return batch;
}

enum PushActionKind {
  /// applied, merged or duplicate: mark the row synced; store [PushAction.revision] when present.
  synced,

  /// Keep the row, status 'conflict', never resend; resolved through the conflicts API.
  conflict,

  /// failed (or no usable result): stays pending and is resent next sync.
  keepPending,
}

class PushAction {
  final PushActionKind kind;
  final String changeId;
  final String objectType;
  final String objectId;

  /// Server status (applied, merged, duplicate, conflict, failed), or null when there was no result.
  final String? status;
  final int? revision;
  final String? conflictId;
  final String? reason;

  const PushAction({
    required this.kind,
    required this.changeId,
    required this.objectType,
    required this.objectId,
    this.status,
    this.revision,
    this.conflictId,
    this.reason,
  });

  @override
  String toString() => 'PushAction($kind, $changeId, status: $status, revision: $revision, '
      'conflictId: $conflictId, reason: $reason)';
}

class PushPlan {
  /// One action per sent row, in the same order.
  final List<PushAction> actions;

  /// The response had no per-change `results`: the server does not speak
  /// protocol 2, so nothing is marked (everything stays pending).
  final bool resultsMissing;

  /// `notice` of the response (for example `client_upgrade_required`).
  final String? notice;
  final String? message;

  const PushPlan({required this.actions, this.resultsMissing = false, this.notice, this.message});

  bool get appUpdateRequired =>
      notice == upgradeRequiredReason || actions.any((a) => a.reason == upgradeRequiredReason);

  SyncState get state {
    if (resultsMissing) return SyncState.serverUpdateRequired;
    if (appUpdateRequired) return SyncState.appUpdateRequired;
    return SyncState.ok;
  }

  int count(PushActionKind kind) => actions.where((a) => a.kind == kind).length;
}

/// Maps a push [response] to one local action per row in [sent].
///
/// - `applied`, `merged`, `duplicate` => synced (with the returned revision);
/// - `conflict` => conflict (with `conflict_id`), never resent;
/// - `failed` => stays pending, with its `reason`;
/// - a missing or mismatched result => stays pending.
///
/// A response without `results` (an older server that only counts) marks
/// nothing: no change is treated as synced or as a conflict.
PushPlan planPushResults(List<Map<String, Object?>> sent, Map<String, dynamic> response) {
  final notice = response['notice'] as String?;
  final message = response['message'] is String ? response['message'] as String : null;
  final results = response['results'];

  PushAction pending(Map<String, Object?> row, {String? status, String? reason}) => PushAction(
        kind: PushActionKind.keepPending,
        changeId: row['id'] as String,
        objectType: row['object_type'] as String,
        objectId: row['object_id'] as String,
        status: status,
        reason: reason,
      );

  if (results is! List) {
    return PushPlan(
      actions: sent.map((row) => pending(row)).toList(),
      resultsMissing: true,
      notice: notice,
      message: message,
    );
  }

  final byIndex = <int, Map>{};
  for (final entry in results) {
    if (entry is! Map) continue;
    final index = entry['index'];
    if (index is int && index >= 0 && index < sent.length) byIndex[index] = entry;
  }

  final actions = <PushAction>[];
  for (var i = 0; i < sent.length; i++) {
    final row = sent[i];
    final id = row['id'] as String;
    final entry = byIndex[i];
    final changeId = entry?['change_id'];
    if (entry == null || (changeId != null && changeId != id)) {
      actions.add(pending(row));
      continue;
    }
    final status = entry['status'] as String?;
    final reason = entry['reason'] as String?;
    final conflictId = entry['conflict_id'] as String?;
    switch (status) {
      case 'applied':
      case 'merged':
      case 'duplicate':
        actions.add(PushAction(
          kind: PushActionKind.synced,
          changeId: id,
          objectType: row['object_type'] as String,
          objectId: row['object_id'] as String,
          status: status,
          revision: parseRevision(entry['revision']),
          conflictId: conflictId,
        ));
        break;
      case 'conflict':
        actions.add(PushAction(
          kind: PushActionKind.conflict,
          changeId: id,
          objectType: row['object_type'] as String,
          objectId: row['object_id'] as String,
          status: status,
          conflictId: conflictId,
          reason: reason,
        ));
        break;
      default:
        actions.add(pending(row, status: status, reason: reason ?? (status == 'failed' ? 'failed' : null)));
    }
  }
  return PushPlan(actions: actions, notice: notice, message: message);
}

/// New `base_revision` for later pending rows of the same record after
/// [action] was applied.
///
/// Only an `applied` change with a returned revision moves the base: the
/// record on the server is then exactly what this device had after that
/// change. A `merged` change also contains edits from elsewhere, so later
/// rows keep their base and the server compares them again (it may report a
/// conflict instead of silently overwriting). Rows whose base differs from
/// the acknowledged row's base were queued on another version and are left.
Map<String, int> rebasedBaseRevisions(
  PushAction action,
  Map<String, Object?> sentRow,
  List<Map<String, Object?>> laterRows,
) {
  if (action.kind != PushActionKind.synced || action.status != 'applied' || action.revision == null) {
    return const {};
  }
  final sentBase = sentRow['change_type'] == 'create' ? null : parseRevision(sentRow['base_revision']);
  final rebased = <String, int>{};
  for (final row in laterRows) {
    if (row['id'] == sentRow['id']) continue;
    if (row['object_type'] != action.objectType || row['object_id'] != action.objectId) continue;
    if ((row['status'] ?? pendingStatus) != pendingStatus || (row['synced'] ?? 0) != 0) continue;
    if (row['change_type'] == 'create') continue;
    if (parseRevision(row['base_revision']) != sentBase) continue;
    rebased[row['id'] as String] = action.revision!;
  }
  return rebased;
}

/// A local delete: `DELETE FROM table WHERE where`.
class LocalDelete {
  final String table;
  final String where;
  final List<Object?> whereArgs;

  const LocalDelete(this.table, this.where, this.whereArgs);

  @override
  bool operator ==(Object other) =>
      other is LocalDelete &&
      other.table == table &&
      other.where == where &&
      jsonEncode(other.whereArgs) == jsonEncode(whereArgs);

  @override
  int get hashCode => Object.hash(table, where, jsonEncode(whereArgs));

  @override
  String toString() => 'LocalDelete($table, $where, $whereArgs)';
}

/// Local deletes for the pull's `tombstones`. Deleting an invoice also removes
/// its local items and attachments; unknown object types are ignored.
List<LocalDelete> tombstoneDeletes(Object? tombstones) {
  if (tombstones is! List) return const [];
  final deletes = <LocalDelete>[];
  for (final t in tombstones) {
    if (t is! Map) continue;
    final type = t['object_type'];
    final id = t['object_id'];
    if (type is! String || id is! String) continue;
    final table = localTableFor[type];
    if (table == null) continue;
    if (type == 'invoice') {
      deletes.add(LocalDelete('invoice_items_local', 'invoice_id = ?', [id]));
      deletes.add(LocalDelete('attachments_local', 'owner_type = ? AND owner_id = ?', ['invoice', id]));
    }
    deletes.add(LocalDelete(table, 'id = ?', [id]));
  }
  return deletes;
}

/// What to do with a pull response.
enum PullStep {
  /// Store the data.
  apply,

  /// `fullResyncRequired`: drop the local cache and pull again without `since`.
  fullResync,
}

/// [sentSince]: whether this pull sent `since`. A full pull is never asked to
/// resync again (no loop).
PullStep pullStep(Map<String, dynamic> response, {required bool sentSince}) =>
    sentSince && response['fullResyncRequired'] == true ? PullStep.fullResync : PullStep.apply;

/// `openConflicts` of a pull response (0 when absent).
int openConflictsOf(Map<String, dynamic> response) => parseRevision(response['openConflicts']) ?? 0;

/// Keys `object_type:object_id` of rows that are still waiting to be sent.
/// Pulled copies of these records do not overwrite the local one.
Set<String> pendingObjectKeys(List<Map<String, Object?>> rows) => {
      for (final row in rows)
        if ((row['status'] ?? pendingStatus) == pendingStatus && (row['synced'] ?? 0) == 0)
          '${row['object_type']}:${row['object_id']}',
    };
