// Dart imports
import 'dart:convert';

// Flutter imports
import 'package:flutter/material.dart';

// Package imports
import 'package:intl/intl.dart';

// Local imports
import '../core/services/sync_conflicts_api.dart';
import '../core/services/sync_protocol.dart' show FailedChange, FailedChangesStore;
import '../models/sync_conflict.dart';

/// Labels of the resolve actions. Only actions the server lists in
/// `allowed_actions` are shown.
const Map<String, String> conflictActionLabels = {
  'dismiss': 'Keep current version',
  'apply_client': 'Use my version',
  'restore': 'Restore',
};

String _formatDate(DateTime? date) =>
    date == null ? '' : DateFormat.yMMMd().add_jm().format(date.toLocal());

/// Open sync conflicts of the signed-in user, and changes from this device
/// that could not be synced. Conflicts show only what the API returns;
/// nothing from it is stored on the device.
class SyncConflictsScreen extends StatefulWidget {
  final SyncConflictsApi api;

  /// Local queue of given-up changes; null where sync is not available.
  final FailedChangesStore? failedChanges;

  const SyncConflictsScreen({super.key, required this.api, this.failedChanges});

  @override
  State<SyncConflictsScreen> createState() => _SyncConflictsScreenState();
}

class _SyncConflictsScreenState extends State<SyncConflictsScreen> {
  List<SyncConflict>? _conflicts;
  List<FailedChange> _failed = const [];
  List<FailedChange> _waiting = const [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    List<FailedChange> failed = const [];
    List<FailedChange> waiting = const [];
    try {
      failed = await widget.failedChanges?.listFailed() ?? const [];
      waiting = await widget.failedChanges?.listWaiting() ?? const [];
    } catch (_) {
      // Local queue unavailable: show the conflicts only.
    }
    try {
      final conflicts = await widget.api.listOpen();
      if (!mounted) return;
      setState(() {
        _conflicts = conflicts;
        _failed = failed;
        _waiting = waiting;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _conflicts = null;
        _failed = failed;
        _waiting = waiting;
        _error = e is SyncConflictsApiException ? e.message : 'Could not load conflicts.';
        _loading = false;
      });
    }
  }

  Future<void> _open(SyncConflict conflict) async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => SyncConflictDetailScreen(
        api: widget.api,
        conflictId: conflict.id,
        localQueue: widget.failedChanges,
      ),
    ));
    if (mounted) await _load();
  }

  Future<void> _retryNow(FailedChange change) async {
    final store = widget.failedChanges;
    if (store == null) return;
    try {
      await store.retryNow(change.id);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not sync now. The change will be retried later.')),
        );
      }
    }
    if (mounted) await _load();
  }

  Future<void> _retry(FailedChange change) async {
    final store = widget.failedChanges;
    if (store == null) return;
    await store.retry(change.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('The change will be sent again on the next sync.')),
    );
    await _load();
  }

  Future<void> _discard(FailedChange change) async {
    final store = widget.failedChanges;
    if (store == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Discard this change?'),
        content: Text('${change.label} will be removed from this device and never sent. '
            'The record on the server stays as it is.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('Discard')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await store.discard(change.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Change discarded. The record is refreshed on the next sync.')),
    );
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    Widget body;
    if (_loading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_error == null && _conflicts!.isEmpty && _failed.isEmpty && _waiting.isEmpty) {
      body = const Center(child: Text('No sync conflicts to review.'));
    } else {
      body = RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(children: [
                  Expanded(child: Text(_error!)),
                  OutlinedButton(onPressed: _load, child: const Text('Try again')),
                ]),
              ),
            for (final c in _conflicts ?? const <SyncConflict>[]) ...[
              ListTile(
                key: ValueKey('conflict-${c.id}'),
                leading: const Icon(Icons.sync_problem, color: Colors.orange),
                title: Text(c.label),
                subtitle: Text('${c.kindLabel} · ${_formatDate(c.createdAt)}\n${c.explanation}'),
                isThreeLine: true,
                onTap: () => _open(c),
              ),
              const Divider(height: 1),
            ],
            if (_waiting.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 24, 16, 4),
                child: Text('Waiting to retry', style: theme.textTheme.titleMedium),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: Text('These could not be sent because of a temporary problem. They are retried automatically.'),
              ),
              for (final w in _waiting)
                ListTile(
                  key: ValueKey('waiting-${w.id}'),
                  leading: const Icon(Icons.schedule, color: Colors.orange),
                  title: Text(w.label),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(w.reasonText),
                      Text(
                        'Attempts: ${w.attempts}'
                        '${w.nextAttemptAt != null ? ' · next attempt ${_formatDate(w.nextAttemptAt)}' : ' · next attempt on the next sync'}',
                      ),
                      TextButton(
                        key: ValueKey('retry-now-${w.id}'),
                        onPressed: () => _retryNow(w),
                        child: const Text('Retry now'),
                      ),
                    ],
                  ),
                ),
            ],
            if (_failed.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 24, 16, 4),
                child: Text('Changes that could not be synced', style: theme.textTheme.titleMedium),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 16),
                child: Text('These are no longer sent. They stay on this device until you discard them.'),
              ),
              for (final f in _failed)
                ListTile(
                  key: ValueKey('failed-${f.id}'),
                  leading: const Icon(Icons.error_outline, color: Colors.red),
                  title: Text(f.label),
                  subtitle: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(f.reasonText),
                      Wrap(
                        spacing: 8,
                        children: [
                          TextButton(
                            key: ValueKey('retry-${f.id}'),
                            onPressed: () => _retry(f),
                            child: const Text('Retry'),
                          ),
                          TextButton(
                            key: ValueKey('discard-${f.id}'),
                            onPressed: () => _discard(f),
                            child: const Text('Discard this change'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Sync conflicts')),
      body: body,
    );
  }
}

/// One conflict: what happened, both versions, and the allowed actions.
class SyncConflictDetailScreen extends StatefulWidget {
  final SyncConflictsApi api;
  final String conflictId;

  /// Told when the conflict is resolved, so the device drops its local
  /// change row and applies the server version it held back.
  final FailedChangesStore? localQueue;

  const SyncConflictDetailScreen({super.key, required this.api, required this.conflictId, this.localQueue});

  @override
  State<SyncConflictDetailScreen> createState() => _SyncConflictDetailScreenState();
}

class _SyncConflictDetailScreenState extends State<SyncConflictDetailScreen> {
  SyncConflictDetail? _detail;
  String? _error;
  bool _gone = false;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detail = await widget.api.get(widget.conflictId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _loading = false;
      });
    } on SyncConflictsApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _gone = e.statusCode == 404;
        _error = _gone ? 'This conflict no longer exists.' : e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load this conflict.';
        _loading = false;
      });
    }
  }

  void _say(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _resolve(String action) async {
    final detail = _detail;
    if (detail == null) return;
    setState(() => _busy = true);
    try {
      final result = await widget.api.resolve(
        widget.conflictId,
        action,
        expectedRevision: detail.current.revision,
      );
      try {
        await widget.localQueue?.conflictResolved(widget.conflictId, action);
      } catch (_) {
        // The next sync notices the resolution too.
      }
      if (!mounted) return;
      setState(() {
        _detail = result;
        _busy = false;
      });
      _say(action == 'dismiss' ? 'Kept the current version.' : 'Conflict resolved.');
    } on SyncConflictsApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      switch (e.statusCode) {
        case 409:
          _say('The record changed since you opened this conflict. Review it again.');
          await _load();
          break;
        case 422:
          _say(e.message);
          break;
        case 404:
          setState(() {
            _gone = true;
            _error = 'This conflict no longer exists.';
          });
          break;
        default:
          _say(e.message);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _busy = false);
      _say('Could not resolve the conflict. Check your connection and try again.');
    }
  }

  static String _show(Object? value) {
    if (value == null) return '—';
    if (value is String) return value.isEmpty ? '(empty)' : value;
    if (value is Map || value is List) return jsonEncode(value);
    return value.toString();
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    Widget body;
    if (_loading && detail == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (_error != null && (detail == null || _gone)) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(_error!, textAlign: TextAlign.center),
            if (!_gone) ...[
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _load, child: const Text('Try again')),
            ],
          ]),
        ),
      );
    } else {
      body = _buildDetail(context, detail!);
    }
    return Scaffold(
      appBar: AppBar(title: Text(detail?.conflict.label ?? 'Sync conflict')),
      body: body,
    );
  }

  Widget _buildDetail(BuildContext context, SyncConflictDetail detail) {
    final c = detail.conflict;
    final current = detail.current;
    final theme = Theme.of(context);
    final highlight = theme.colorScheme.errorContainer;
    final open = c.status == 'open';

    final rows = <TableRow>[
      TableRow(
        decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest),
        children: const [
          _Cell('Field', bold: true),
          _Cell('Your version', bold: true),
          _Cell('Current version', bold: true),
        ],
      ),
      for (final field in detail.comparedFields)
        TableRow(
          key: ValueKey('row-$field'),
          decoration: c.conflictingFields.contains(field) ? BoxDecoration(color: highlight) : null,
          children: [
            _Cell(field, bold: c.conflictingFields.contains(field)),
            _Cell(c.yourChanges.containsKey(field)
                ? _show(c.yourChanges[field])
                : (c.changeType == 'delete' ? 'deleted' : '—')),
            _Cell(current.deleted ? 'deleted' : _show(current.fields?[field])),
          ],
        ),
    ];

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('What happened', style: theme.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(c.explanation),
        const SizedBox(height: 8),
        Text('${c.kindLabel} · ${_formatDate(c.createdAt)}', style: theme.textTheme.bodySmall),
        if (!open)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Resolved${c.resolution != null ? ' (${conflictActionLabels[c.resolution] ?? c.resolution})' : ''}.',
              style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
          ),
        if (current.deleted)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('The record is currently deleted.', style: TextStyle(color: theme.colorScheme.error)),
          ),
        if (current.deleted && c.serverVersion != null && c.serverVersion!.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Version kept on the server when it was deleted', style: theme.textTheme.titleSmall),
          const SizedBox(height: 4),
          for (final e in c.serverVersion!.entries) Text('${e.key}: ${_show(e.value)}'),
        ],
        const SizedBox(height: 16),
        if (c.changeType == 'delete' && c.yourChanges.isEmpty)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text('Your version: deleted on this device.'),
          ),
        if (detail.comparedFields.isNotEmpty && !(current.deleted && c.changeType == 'delete'))
          Table(
            border: TableBorder.all(color: theme.dividerColor),
            columnWidths: const {0: IntrinsicColumnWidth(), 1: FlexColumnWidth(), 2: FlexColumnWidth()},
            children: rows,
          ),
        if (c.conflictingFields.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('Highlighted: changed both here and elsewhere (${c.conflictingFields.join(', ')}).',
                style: theme.textTheme.bodySmall),
          ),
        if (c.omittedFields.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('Not shown: ${c.omittedFields.join(', ')}.', style: theme.textTheme.bodySmall),
          ),
        const SizedBox(height: 24),
        if (_busy) const Center(child: CircularProgressIndicator()),
        if (!_busy && open)
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              for (final action in const ['dismiss', 'apply_client', 'restore'])
                if (c.allowedActions.contains(action))
                  action == 'dismiss'
                      ? OutlinedButton(
                          key: ValueKey('action-$action'),
                          onPressed: () => _resolve(action),
                          child: Text(conflictActionLabels[action]!),
                        )
                      : FilledButton(
                          key: ValueKey('action-$action'),
                          onPressed: () => _resolve(action),
                          child: Text(conflictActionLabels[action]!),
                        ),
            ],
          ),
      ],
    );
  }
}

class _Cell extends StatelessWidget {
  final String text;
  final bool bold;

  const _Cell(this.text, {this.bold = false});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(8),
        child: Text(text, style: bold ? const TextStyle(fontWeight: FontWeight.bold) : null),
      );
}
