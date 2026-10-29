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

/// Permanently rejected (any server reason other than [retryLaterReason]);
/// no longer sent until the user retries or discards it.
const String failedStatus = 'failed';

/// Server reason for a temporary failure (for example a database error).
const String retryLaterReason = 'retry_later';

/// Local reasons of temporary failures (no answer from the server).
const String networkErrorReason = 'network_error';
const String serverErrorReason = 'server_error';
const String noResultReason = 'no_result';

/// Temporary failures: the change stays pending and is retried with backoff.
/// A `failed` result without a reason comes from an older server.
bool isTemporaryFailure(String? reason) =>
    reason == null ||
    reason == retryLaterReason ||
    reason == networkErrorReason ||
    reason == serverErrorReason ||
    reason == noResultReason;

/// Backoff: 30 s, doubling per attempt, at most 1 h.
const Duration backoffBase = Duration(seconds: 30);
const Duration backoffMax = Duration(hours: 1);

/// Delay before the next attempt after [attempts] temporary failures (>= 1).
/// [jitter] in [0, 1) spreads devices: the delay is 75 % to 100 % of the
/// nominal one, so it never exceeds [backoffMax].
Duration backoffDelay(int attempts, double jitter) {
  final n = attempts < 1 ? 1 : attempts;
  var nominal = backoffBase.inMilliseconds;
  for (var i = 1; i < n && nominal < backoffMax.inMilliseconds; i++) {
    nominal *= 2;
  }
  if (nominal > backoffMax.inMilliseconds) nominal = backoffMax.inMilliseconds;
  final j = jitter.clamp(0.0, 0.999999);
  return Duration(milliseconds: (nominal * (0.75 + 0.25 * j)).round());
}

/// When a change may be sent again (`next_attempt_at`, UTC ISO-8601).
DateTime nextAttemptAt(DateTime now, int attempts, double jitter) =>
    now.toUtc().add(backoffDelay(attempts, jitter));

/// Whether a pending row is waiting for its next attempt at [now].
bool isWaiting(Map<String, Object?> row, DateTime now) {
  final next = row['next_attempt_at'];
  if (next is! String) return false;
  final at = DateTime.tryParse(next);
  return at != null && at.isAfter(now.toUtc());
}

/// A failure reason in plain words.
String failureReasonText(String? reason) {
  switch (reason) {
    case 'base_revision_required':
      return 'The change was saved by an older version of the app and does not say which version of the record it was based on.';
    case 'change_id_required':
      return 'The change has no identifier, so the server cannot accept it.';
    case 'change_id_reused':
      return 'A different change with the same identifier was already received by the server.';
    case 'invalid_object_id':
      return 'The record identifier is not valid.';
    case 'invalid_base_revision':
      return 'The change refers to a version of the record the server does not have.';
    case 'not_found':
      return 'The record does not exist on the server.';
    case 'record_deleted':
      return 'The record was deleted on the server.';
    case 'rejected':
      return 'The server refused the change (for example invalid data, or a record that is not yours).';
    case retryLaterReason:
      return 'The server could not process the change right now.';
    case networkErrorReason:
      return 'The server could not be reached.';
    case serverErrorReason:
      return 'The server had an error.';
    case noResultReason:
      return 'The server did not report a result for the change.';
    case 'open_conflict':
      return 'The record has an unresolved sync conflict.';
    case upgradeRequiredReason:
      return 'The server needs a newer version of the app for this change.';
    case null:
      return 'The server did not process the change (no reason given).';
    case 'failed':
      return 'The server did not accept the change.';
    default:
      return 'The server did not accept the change ($reason).';
  }
}

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
  final parent = parseRevision(row['parent_base_revision']);
  return {
    'change_id': row['id'] as String,
    if (changeType != 'create' && base != null) 'base_revision': base,
    if (row['object_type'] == 'invoice_item' && parent != null) 'parent_revision': parent,
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
/// own earlier change. For the same reason an item change waits when a
/// change of its invoice is sent first (its `parent_revision` moves then).
/// Rows rejected ('failed') or in conflict block nothing. A row waiting for
/// its next attempt ([isWaiting] at [now]) is not sent and holds back later
/// changes of the same record; other records' changes still go.
List<Map<String, Object?>> selectPushBatch(List<Map<String, Object?>> rows, {DateTime? now}) {
  final at = now ?? DateTime.now();
  final seen = <String>{};
  final batch = <Map<String, Object?>>[];
  for (final row in rows) {
    if ((row['status'] ?? pendingStatus) != pendingStatus) continue;
    if ((row['synced'] ?? 0) != 0) continue;
    final key = '${row['object_type']}:${row['object_id']}';
    if (isWaiting(row, at)) {
      seen.add(key);
      continue;
    }
    final parent = row['parent_id'];
    if (row['object_type'] == 'invoice_item' && parent is String && seen.contains('invoice:$parent')) {
      seen.add(key);
      continue;
    }
    if (seen.add(key)) batch.add(row);
  }
  return batch;
}

enum PushActionKind {
  /// applied, merged or duplicate: mark the row synced; store [PushAction.revision] when present.
  synced,

  /// Keep the row, status 'conflict', never resend; resolved through the conflicts API.
  conflict,

  /// Temporary failure ([isTemporaryFailure], or no usable result): stays
  /// pending, one more attempt, retried after a backoff. Never abandoned.
  keepPending,

  /// Permanent rejection (any other reason): status 'failed', no longer
  /// sent, blocks nothing; the user can retry or discard it.
  giveUp,
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

  /// Attempts after this result (temporary failures; kept on rejection).
  final int attempts;

  const PushAction({
    required this.kind,
    required this.changeId,
    required this.objectType,
    required this.objectId,
    this.status,
    this.revision,
    this.conflictId,
    this.reason,
    this.attempts = 0,
  });

  @override
  String toString() => 'PushAction($kind, $changeId, status: $status, revision: $revision, '
      'conflictId: $conflictId, reason: $reason, attempts: $attempts)';
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
/// - `failed` with `retry_later`, `failed` without a reason (older server),
///   or no result for the row => temporary: one more attempt, backoff;
/// - `failed` with any other reason => permanently rejected (status 'failed').
///
/// A response without `results` (an older server that only counts) marks
/// nothing: no change is treated as synced, failed or as a conflict.
PushPlan planPushResults(List<Map<String, Object?>> sent, Map<String, dynamic> response) {
  final notice = response['notice'] as String?;
  final message = response['message'] is String ? response['message'] as String : null;
  final results = response['results'];

  PushAction untouched(Map<String, Object?> row) => PushAction(
        kind: PushActionKind.keepPending,
        changeId: row['id'] as String,
        objectType: row['object_type'] as String,
        objectId: row['object_id'] as String,
        attempts: parseRevision(row['attempts']) ?? 0,
      );

  if (results is! List) {
    return PushPlan(
      actions: sent.map(untouched).toList(),
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
      actions.add(temporaryFailure(row, noResultReason));
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
      case 'failed':
        actions.add(isTemporaryFailure(reason)
            ? temporaryFailure(row, reason, status: 'failed')
            : PushAction(
                kind: PushActionKind.giveUp,
                changeId: id,
                objectType: row['object_type'] as String,
                objectId: row['object_id'] as String,
                status: 'failed',
                reason: reason,
                attempts: parseRevision(row['attempts']) ?? 0,
              ));
        break;
      default:
        actions.add(temporaryFailure(row, reason ?? noResultReason, status: status));
    }
  }
  return PushPlan(actions: actions, notice: notice, message: message);
}

/// A temporary failure of [row]: stays pending with one more attempt.
/// [status] is the server's status when it answered (`failed`: not applied).
PushAction temporaryFailure(Map<String, Object?> row, String? reason, {String? status}) => PushAction(
      kind: PushActionKind.keepPending,
      changeId: row['id'] as String,
      objectType: row['object_type'] as String,
      objectId: row['object_id'] as String,
      status: status,
      reason: reason,
      attempts: (parseRevision(row['attempts']) ?? 0) + 1,
    );

/// No answer for the whole push (network error, timeout, HTTP 5xx): every
/// sent row has a temporary failure.
PushPlan transportFailure(List<Map<String, Object?>> sent, String reason) =>
    PushPlan(actions: [for (final row in sent) temporaryFailure(row, reason)]);

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

/// New `parent_base_revision` for queued item changes after a change of
/// their invoice was applied or merged: the items were edited on the
/// invoice as this device had it, which is now the returned revision. Only
/// items queued on the same invoice version as [sentRow] move.
Map<String, int> rebasedParentRevisions(
  PushAction action,
  Map<String, Object?> sentRow,
  List<Map<String, Object?>> laterRows,
) {
  if (action.kind != PushActionKind.synced ||
      action.objectType != 'invoice' ||
      (action.status != 'applied' && action.status != 'merged') ||
      action.revision == null) {
    return const {};
  }
  final sentBase = sentRow['change_type'] == 'create' ? null : parseRevision(sentRow['base_revision']);
  final rebased = <String, int>{};
  for (final row in laterRows) {
    if (row['object_type'] != 'invoice_item' || row['parent_id'] != action.objectId) continue;
    if ((row['status'] ?? pendingStatus) != pendingStatus || (row['synced'] ?? 0) != 0) continue;
    if (parseRevision(row['parent_base_revision']) != sentBase) continue;
    rebased[row['id'] as String] = action.revision!;
  }
  return rebased;
}

/// pending_changes.last_result: what is known about the row's last send.
/// null = never sent; [sentUnknown] = sent, no result (the server may have
/// applied it); [sentFailed] = the server answered `failed` (not applied).
const String sentUnknown = 'unknown';
const String sentFailed = 'failed';

/// How a row may be rebased.
enum RebaseMode {
  /// Never sent: change the revision, keep the change_id.
  keepId,

  /// Sent and failed: the server stored the old revision with the old
  /// change_id, so the rebased row needs a new change_id.
  newChangeId,

  /// Outcome of the last send unknown: leave the row as it is, so a resend is
  /// answered from the stored outcome (`duplicate` if it was applied).
  skip,
}

RebaseMode rebaseModeOf(Map<String, Object?> row) {
  switch (row['last_result']) {
    case null:
      return RebaseMode.keepId;
    case sentFailed:
      return RebaseMode.newChangeId;
    default:
      return RebaseMode.skip;
  }
}

/// One rebase to write: new revision values for row [rowId], under a new
/// change_id when [newChangeId].
class RebaseUpdate {
  final String rowId;
  final Map<String, int> values;
  final bool newChangeId;

  const RebaseUpdate(this.rowId, this.values, this.newChangeId);

  @override
  String toString() => 'RebaseUpdate($rowId, $values, newChangeId: $newChangeId)';
}

/// Rebases after a push round: [settled] are the synced actions with the row
/// each was sent from; [rowsNow] are the queued rows as stored after the
/// round's results (so `last_result` reflects this round).
List<RebaseUpdate> planRebases(
  List<(PushAction, Map<String, Object?>)> settled,
  List<Map<String, Object?>> rowsNow,
) {
  final values = <String, Map<String, int>>{};
  for (final (action, sentRow) in settled) {
    rebasedBaseRevisions(action, sentRow, rowsNow)
        .forEach((id, rev) => (values[id] ??= {})['base_revision'] = rev);
    rebasedParentRevisions(action, sentRow, rowsNow)
        .forEach((id, rev) => (values[id] ??= {})['parent_base_revision'] = rev);
  }
  final byId = {for (final r in rowsNow) r['id'] as String: r};
  final updates = <RebaseUpdate>[];
  values.forEach((id, v) {
    final row = byId[id];
    if (row == null) return;
    final mode = rebaseModeOf(row);
    if (mode == RebaseMode.skip) return;
    updates.add(RebaseUpdate(id, v, mode == RebaseMode.newChangeId));
  });
  return updates;
}

/// The invoice an item change names in its data (create, or a move).
String? itemInvoiceIdFromData(Map<String, dynamic> data) {
  final v = data['invoiceId'] ?? data['invoice_id'];
  return v is String && v.isNotEmpty ? v : null;
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

/// What to do with a pull page.
enum PullStep {
  /// Store the page.
  apply,

  /// `fullResyncRequired`: drop the local cache and the cursor, pull from the start.
  fullResync,
}

/// [sentCursor]: whether this page was asked for with a cursor. A pull from
/// the start is never asked to resync again (no loop).
PullStep pullStep(Map<String, dynamic> response, {required bool sentCursor}) =>
    sentCursor && response['fullResyncRequired'] == true ? PullStep.fullResync : PullStep.apply;

/// Records per pull page (server range 1..1000).
const int pullPageLimit = 500;

/// Upper bound of pages in one pull (500,000 records at the default limit).
const int maxPullPages = 1000;

/// Query of one pull page. No cursor = from the start.
/// `protocol=2` on every pull: without it (and without a cursor, as on the
/// first pull) the server answers with the protocol-1 timestamp pull, which
/// returns no cursor.
Map<String, dynamic> pullQuery(String? cursor, {int limit = pullPageLimit}) => {
      'protocol': '2',
      if (cursor != null) 'cursor': cursor,
      'limit': limit,
    };

/// The cursor to start from: none (everything) when there is no stored
/// cursor (first pull, or an app that synced with `since` before) or after a
/// change was rejected or discarded (earlier pulls skipped that record).
String? startCursor(String? stored, {required bool fullPullNeeded}) => fullPullNeeded ? null : stored;

/// The server refused the cursor (400 `reason: invalid_cursor`).
class InvalidCursorException implements Exception {
  const InvalidCursorException();
}

bool isInvalidCursorResponse(int? statusCode, Object? data) =>
    statusCode == 400 && data is Map && data['reason'] == 'invalid_cursor';

class PullRunResult {
  /// Cursor to store (from the last page, hasMore false).
  final String? cursor;
  final int openConflicts;
  final String? lastSyncTimestamp;
  final int pages;

  /// The run restarted from the start (fullResyncRequired or invalid cursor).
  final bool restarted;

  const PullRunResult({this.cursor, this.openConflicts = 0, this.lastSyncTimestamp, this.pages = 0, this.restarted = false});
}

/// Runs a cursor pull: fetch a page, apply it, continue while `hasMore`.
/// The caller stores [PullRunResult.cursor] only after this returns, so an
/// interrupted pull restarts from the previously stored cursor (pages may be
/// delivered again; applying them is idempotent).
///
/// - `fullResyncRequired`: [clearCache], [dropCursor], start again without cursor;
/// - [InvalidCursorException] from [fetch]: [dropCursor], start again without cursor.
/// Each happens at most once per run.
Future<PullRunResult> runCursorPull({
  required String? storedCursor,
  required Future<Map<String, dynamic>> Function(String? cursor) fetch,
  required Future<void> Function(Map<String, dynamic> page) applyPage,
  required Future<void> Function() clearCache,
  required Future<void> Function() dropCursor,
  int maxPages = maxPullPages,
}) async {
  var start = storedCursor;
  var restarted = false;
  while (true) {
    String? next = start;
    var pages = 0;
    try {
      while (true) {
        final page = await fetch(next);
        if (pullStep(page, sentCursor: next != null) == PullStep.fullResync) {
          if (restarted) throw StateError('fullResyncRequired on a pull from the start');
          restarted = true;
          await clearCache();
          await dropCursor();
          break;
        }
        await applyPage(page);
        pages++;
        final cursor = page['cursor'];
        if (page['hasMore'] == true) {
          if (cursor is! String || cursor.isEmpty) throw const FormatException('hasMore without a cursor');
          if (pages >= maxPages) throw StateError('pull exceeded $maxPages pages');
          next = cursor;
          continue;
        }
        return PullRunResult(
          cursor: cursor is String && cursor.isNotEmpty ? cursor : null,
          openConflicts: openConflictsOf(page),
          lastSyncTimestamp: page['lastSyncTimestamp'] as String?,
          pages: pages,
          restarted: restarted,
        );
      }
    } on InvalidCursorException {
      if (restarted || next == null) rethrow;
      restarted = true;
      await dropCursor();
    }
    start = null;
  }
}

/// `openConflicts` of a pull response (0 when absent).
int openConflictsOf(Map<String, dynamic> response) => parseRevision(response['openConflicts']) ?? 0;

/// A newly delivered server row replaces a held one unless it is older.
/// Rows without a revision (attachments) always replace.
bool deliveredReplacesHeld(int? deliveredRevision, int? heldRevision) =>
    deliveredRevision == null || heldRevision == null || deliveredRevision >= heldRevision;

/// A held server row is written locally unless the local copy is already at
/// the same or a newer revision (for example after the device's change was
/// applied and its new revision stored). Without revisions it is written.
bool heldRowApplies(int? heldRevision, int? localRevision) =>
    heldRevision == null || localRevision == null || heldRevision > localRevision;

/// Keys `object_type:object_id` of records with a pending or conflict
/// change: held server rows of these wait.
Set<String> heldBackObjectKeys(List<Map<String, Object?>> rows) => {
      for (final row in rows)
        if ((row['synced'] ?? 0) == 0 &&
            ((row['status'] ?? pendingStatus) == pendingStatus || row['status'] == conflictStatus))
          '${row['object_type']}:${row['object_id']}',
    };

/// Keys `object_type:object_id` of rows that are still waiting to be sent.
/// Pulled copies of these records do not overwrite the local one.
Set<String> pendingObjectKeys(List<Map<String, Object?>> rows) => {
      for (final row in rows)
        if ((row['status'] ?? pendingStatus) == pendingStatus && (row['synced'] ?? 0) == 0)
          '${row['object_type']}:${row['object_id']}',
    };

/// A queued change that was rejected (status 'failed'), or one waiting to
/// retry after temporary failures (status 'pending', attempts > 0).
class FailedChange {
  final String id;
  final String objectType;
  final String objectId;
  final String changeType;
  final String? reason;
  final int attempts;
  final DateTime? createdAt;

  /// Temporary failures: when the next attempt is due (null = now).
  final DateTime? nextAttemptAt;

  const FailedChange({
    required this.id,
    required this.objectType,
    required this.objectId,
    required this.changeType,
    this.reason,
    this.attempts = 0,
    this.createdAt,
    this.nextAttemptAt,
  });

  factory FailedChange.fromRow(Map<String, Object?> row) => FailedChange(
        id: row['id'] as String,
        objectType: row['object_type'] as String,
        objectId: row['object_id'] as String,
        changeType: row['change_type'] as String,
        reason: row['last_reason'] as String?,
        attempts: parseRevision(row['attempts']) ?? 0,
        createdAt: DateTime.tryParse(row['created_at'] as String? ?? ''),
        nextAttemptAt: DateTime.tryParse(row['next_attempt_at'] as String? ?? ''),
      );

  /// For example "Invoice item 1a2b3c4d (update)".
  String get label {
    const names = {'client': 'Client', 'invoice': 'Invoice', 'invoice_item': 'Invoice item', 'attachment': 'Attachment'};
    final shortId = objectId.length > 8 ? objectId.substring(0, 8) : objectId;
    return '${names[objectType] ?? objectType} $shortId ($changeType)';
  }

  String get reasonText => failureReasonText(reason);
}

/// Changes that could not be synced, and changes waiting to retry (local only).
abstract class FailedChangesStore {
  /// Permanently rejected changes.
  Future<List<FailedChange>> listFailed();

  /// Pending changes with temporary failures (attempts > 0).
  Future<List<FailedChange>> listWaiting();

  /// Sends a waiting change now (clears its wait and syncs).
  Future<void> retryNow(String id);

  /// Removes the queued change from this device; nothing is sent.
  Future<void> discard(String id);

  /// A conflict was resolved with [action] (`dismiss`, `apply_client`,
  /// `restore`): forget its local change rows. After `dismiss` the server row
  /// held for the record is applied; after a resolution that wrote a new
  /// version on the server it is dropped (the next pull delivers the new one).
  Future<void> conflictResolved(String conflictId, String action);

  /// Queues a rejected change again (status pending, attempts 0, no wait).
  Future<void> retry(String id);
}
