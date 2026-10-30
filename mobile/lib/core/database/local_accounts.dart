// Dart imports
import 'dart:async';
import 'dart:convert';
import 'dart:io';

// Package imports
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart' as sqflite;
import 'package:sqflite/sqflite.dart' show Database, DatabaseFactory, ConflictAlgorithm;

// Local imports
import 'database_helper.dart';

/// Keys of the sync_meta table (one set per account database).
class SyncMeta {
  /// The account this database belongs to (verified user id).
  static const owner = 'account_user_id';

  /// Opaque pull cursor, stored only after every page of a pull was applied.
  static const cursor = 'cursor';
  static const state = 'state';
  static const openConflicts = 'open_conflicts';

  /// Time of the last completed pull (display only).
  static const lastSync = 'last_sync';

  /// Set on a database moved aside because its owner could not be established.
  static const quarantinedAt = 'quarantined_at';
}

/// No account is signed in, so there is no local data to use.
class NoActiveAccountException implements Exception {
  const NoActiveAccountException();
  @override
  String toString() => 'No account is signed in on this device';
}

/// The signed-in account changed while work for the previous one was running;
/// that work stops without writing anything.
class AccountChangedException implements Exception {
  const AccountChangedException();
  @override
  String toString() => 'The signed-in account changed; the previous account\'s work was stopped';
}

/// Removing local data would lose changes that were never sent.
class UnsyncedChangesException implements Exception {
  final int count;
  const UnsyncedChangesException(this.count);
  @override
  String toString() => '$count local change(s) have not been synced';
}

/// A local database from an earlier app version whose owner could not be
/// established. It is not shown to, used by or synced for any account.
class QuarantinedStore {
  final String path;
  final DateTime? quarantinedAt;

  /// Changes never sent: in total, recorded for the signed-in account, and
  /// recorded for other accounts (the rest have no account). All null when
  /// the file could not be read (it may hold unsynced changes).
  final int? unsyncedChanges;
  final int? unsyncedForActiveAccount;
  final int? unsyncedForOtherAccounts;

  const QuarantinedStore({
    required this.path,
    required this.quarantinedAt,
    required this.unsyncedChanges,
    required this.unsyncedForActiveAccount,
    required this.unsyncedForOtherAccounts,
  });

  bool get readable => unsyncedChanges != null;

  /// Removable by the signed-in account: holds no change recorded for
  /// another account (those stay until that account recovers them).
  bool get removable => unsyncedForOtherAccounts == null || unsyncedForOtherAccounts == 0;
}

/// Per-account local storage. Every account that signs in on this device has
/// its own SQLite database (cached records and attachments, queued changes
/// and retries, conflicts, held server rows, conflict checks and the pull
/// cursor); only the signed-in account's database is open. Signing out
/// closes it and keeps it on the device, so unsynced work stays for that
/// account to resume.
///
/// Each transition (sign-in, sign-out) increments [generation] before
/// anything else and waits for the registered transition hooks (the sync
/// service stops its running sync), so work started for one account cannot
/// write into the next account's database.
class LocalAccounts {
  static LocalAccounts? _instance;

  /// The app's instance (tests may replace it).
  static LocalAccounts get instance => _instance ??= LocalAccounts();
  static set instance(LocalAccounts value) => _instance = value;

  final DatabaseFactory? _factoryOverride;
  final Future<String> Function() _rootDirectory;
  final DateTime Function() _clock;

  LocalAccounts({DatabaseFactory? factory, Future<String> Function()? directory, DateTime Function()? clock})
      : _factoryOverride = factory,
        _rootDirectory = directory ?? _documentsDirectory,
        _clock = clock ?? DateTime.now;

  static Future<String> _documentsDirectory() async => (await getApplicationDocumentsDirectory()).path;

  DatabaseFactory get _factory => _factoryOverride ?? sqflite.databaseFactory;

  /// The single database file of earlier app versions (shared by every account).
  static const legacyFileName = 'invoiceme.db';
  static const accountsDirName = 'accounts';

  /// Device-wide preferences of earlier versions that described one
  /// (unknown) account's sync position or data; never reused.
  static const legacyPreferenceKeys = [
    'sync_cursor',
    'sync_state',
    'sync_open_conflicts',
    'last_sync_timestamp',
    'sync_full_pull_needed',
    'dashboard_stats_cache',
  ];

  int _generation = 0;
  String? _activeUserId;
  Database? _active;
  final List<Future<void> Function()> _transitionHooks = [];
  Future<void> _tail = Future.value();

  /// Changes on every sign-in and sign-out.
  int get generation => _generation;
  String? get activeUserId => _activeUserId;

  /// Whether work started at [generation] still belongs to the signed-in account.
  bool isCurrent(int generation) => generation == _generation && _active != null;

  /// Called (and awaited) on every transition after [generation] changed and
  /// before the previous account's database is closed.
  void addTransitionHook(Future<void> Function() hook) => _transitionHooks.add(hook);

  /// The signed-in account's database.
  Future<Database> database() async {
    final db = _active;
    if (db == null) throw const NoActiveAccountException();
    return db;
  }

  Future<T> _serialized<T>(Future<T> Function() action) {
    final result = _tail.then((_) => action());
    _tail = result.then((_) {}, onError: (_) {});
    return result;
  }

  /// File name part for [userId]: the id itself when it is a plain token
  /// (server ids are UUIDs), otherwise its hex encoding.
  static String accountKey(String userId) {
    if (userId.isEmpty) throw ArgumentError('empty user id');
    if (RegExp(r'^[A-Za-z0-9-]{1,64}$').hasMatch(userId)) return 'u-$userId';
    return 'h-${utf8.encode(userId).map((b) => b.toRadixString(16).padLeft(2, '0')).join()}';
  }

  Future<String> _accountsDir() async {
    final dir = Directory(p.join(await _rootDirectory(), accountsDirName));
    await dir.create(recursive: true);
    return dir.path;
  }

  Future<String> pathFor(String userId) async => p.join(await _accountsDir(), '${accountKey(userId)}.db');

  /// Opens [userId]'s database (after the previous account's work stopped).
  /// [userId] must be the identity the server confirmed for the session.
  Future<void> activate(String userId) => _serialized(() async {
        if (_activeUserId == userId && _active != null) return;
        await _deactivateLocked();
        await _migrateLegacyLocked();
        final path = await pathFor(userId);
        final db = await DatabaseHelper.openAt(_factory, path);
        final owner = await DatabaseHelper.readMeta(db, SyncMeta.owner);
        if (owner == null) {
          await DatabaseHelper.writeMeta(db, SyncMeta.owner, userId);
        } else if (owner != userId) {
          await db.close();
          throw StateError('The local database at $path belongs to another account');
        }
        _generation++;
        _active = db;
        _activeUserId = userId;
      });

  /// Marks the signed-in account's running work as stale at once (it stops
  /// before its next request or write); [deactivate] follows. Called first
  /// on sign-out, before anything else is awaited.
  void invalidate() => _generation++;

  /// Stops the signed-in account's work and closes its database; its data
  /// stays on the device.
  Future<void> deactivate() => _serialized(_deactivateLocked);

  Future<void> _deactivateLocked() async {
    // Invalidate first: from here on no running work may write or send.
    _generation++;
    final db = _active;
    _active = null;
    _activeUserId = null;
    for (final hook in List.of(_transitionHooks)) {
      try {
        await hook();
      } catch (_) {
        // A hook that fails must not keep the previous account active.
      }
    }
    await db?.close();
  }

  /// Unsynced changes (pending, waiting to retry, failed or in conflict) of
  /// the signed-in account.
  Future<int> unsyncedCount() async => _unsynced(await database());

  static Future<int> _unsynced(Database db) async =>
      sqflite.Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM pending_changes WHERE synced = 0')) ?? 0;

  /// Permanently removes [userId]'s local data. Refused with
  /// [UnsyncedChangesException] when it holds unsynced changes, unless the
  /// person confirmed that loss ([confirmUnsyncedLoss]).
  Future<void> removeAccountData(String userId, {required bool confirmUnsyncedLoss}) => _serialized(() async {
        final path = await pathFor(userId);
        if (_activeUserId == userId) await _deactivateLocked();
        if (!await File(path).exists()) return;
        final db = await DatabaseHelper.openAt(_factory, path);
        final unsynced = await _unsynced(db);
        await db.close();
        if (unsynced > 0 && !confirmUnsyncedLoss) throw UnsyncedChangesException(unsynced);
        await _factory.deleteDatabase(path);
      });

  /// Moves the shared database of earlier versions out of the way, once:
  /// - no data: removed;
  /// - every record and queued change belongs to one account (by the user id
  ///   stored with it): it becomes that account's database, whoever signs in;
  /// - otherwise (several accounts, or a change without an account): it is
  ///   quarantined, used by no account (see [quarantinedStores]).
  /// The old device-wide sync position is dropped either way: the next sync
  /// of each account downloads everything again (queued changes are kept).
  Future<void> migrateLegacy() => _serialized(_migrateLegacyLocked);

  Future<void> _migrateLegacyLocked() async {
    final root = await _rootDirectory();
    final legacyPath = p.join(root, legacyFileName);
    if (await File(legacyPath).exists()) {
      String? owner;
      bool empty;
      var readable = true;
      try {
        final db = await DatabaseHelper.openAt(_factory, legacyPath);
        try {
          owner = await legacyOwner(db);
          empty = await _isEmpty(db);
        } finally {
          await db.close();
        }
      } catch (_) {
        // Unreadable: kept, unread, in quarantine.
        readable = false;
        empty = false;
      }
      if (empty) {
        await _factory.deleteDatabase(legacyPath);
      } else {
        final target = owner == null ? null : await pathFor(owner);
        if (target != null && !await File(target).exists()) {
          await _moveDatabase(legacyPath, target);
          final moved = await DatabaseHelper.openAt(_factory, target);
          await DatabaseHelper.writeMeta(moved, SyncMeta.owner, owner);
          await moved.close();
        } else {
          final stamp = _clock().toUtc().toIso8601String().replaceAll(RegExp(r'[^0-9]'), '');
          final target = p.join(await _accountsDir(), 'quarantine-$stamp.db');
          await _moveDatabase(legacyPath, target);
          if (readable) {
            final moved = await DatabaseHelper.openAt(_factory, target);
            await DatabaseHelper.writeMeta(moved, SyncMeta.quarantinedAt, _clock().toUtc().toIso8601String());
            await moved.close();
          }
        }
      }
    }
    final prefs = await SharedPreferences.getInstance();
    for (final key in legacyPreferenceKeys) {
      if (prefs.containsKey(key)) await prefs.remove(key);
    }
  }

  /// The single account the data of a legacy database belongs to, or null
  /// when it cannot be established (no user id, or more than one).
  static Future<String?> legacyOwner(Database db) async {
    final rows = await db.rawQuery('''
        SELECT user_id FROM pending_changes
        UNION SELECT user_id FROM clients_local
        UNION SELECT user_id FROM invoices_local''');
    final ids = {for (final r in rows) (r['user_id'] as String?) ?? ''};
    if (ids.length != 1 || ids.single.isEmpty) return null;
    // Rows without a user id of their own must belong to a record of that
    // account (held server rows cannot be attributed).
    final unattributed = sqflite.Sqflite.firstIntValue(await db.rawQuery('''
        SELECT (SELECT COUNT(*) FROM invoice_items_local
                 WHERE invoice_id NOT IN (SELECT id FROM invoices_local))
             + (SELECT COUNT(*) FROM attachments_local
                 WHERE owner_id NOT IN (SELECT id FROM invoices_local UNION SELECT id FROM clients_local))
             + (SELECT COUNT(*) FROM sync_held_rows)''')) ?? 0;
    if (unattributed > 0) return null;
    return ids.single;
  }

  static Future<bool> _isEmpty(Database db) async {
    for (final table in [
      'pending_changes',
      'clients_local',
      'invoices_local',
      'invoice_items_local',
      'attachments_local',
      'sync_held_rows',
    ]) {
      final n = sqflite.Sqflite.firstIntValue(await db.rawQuery('SELECT COUNT(*) FROM $table')) ?? 0;
      if (n > 0) return false;
    }
    return true;
  }

  Future<void> _moveDatabase(String from, String to) async {
    // Side files first, so an interruption never leaves the main file
    // separated from its journal.
    for (final suffix in ['-journal', '-wal', '-shm', '']) {
      final f = File('$from$suffix');
      if (await f.exists()) await f.rename('$to$suffix');
    }
  }

  /// Quarantined databases, with what they hold for the signed-in account.
  Future<List<QuarantinedStore>> quarantinedStores() async {
    final dir = Directory(await _accountsDir());
    final stores = <QuarantinedStore>[];
    final files = await dir
        .list()
        .where((e) => e is File && p.basename(e.path).startsWith('quarantine-') && e.path.endsWith('.db'))
        .toList();
    files.sort((a, b) => a.path.compareTo(b.path));
    for (final f in files) {
      final Database db;
      try {
        db = await DatabaseHelper.openAt(_factory, f.path);
      } catch (_) {
        // Unreadable (kept as it was found); counts unknown.
        stores.add(QuarantinedStore(
          path: f.path,
          quarantinedAt: null,
          unsyncedChanges: null,
          unsyncedForActiveAccount: null,
          unsyncedForOtherAccounts: null,
        ));
        continue;
      }
      try {
        final active = _activeUserId;
        final mine = active == null
            ? 0
            : sqflite.Sqflite.firstIntValue(await db.rawQuery(
                    'SELECT COUNT(*) FROM pending_changes WHERE synced = 0 AND user_id = ?', [active],),) ??
                0;
        stores.add(QuarantinedStore(
          path: f.path,
          quarantinedAt: DateTime.tryParse(await DatabaseHelper.readMeta(db, SyncMeta.quarantinedAt) ?? ''),
          unsyncedChanges: await _unsynced(db),
          unsyncedForActiveAccount: mine,
          unsyncedForOtherAccounts: sqflite.Sqflite.firstIntValue(
                await db.rawQuery("SELECT COUNT(*) FROM pending_changes WHERE synced = 0 AND user_id <> '' AND user_id IS NOT ?", [active]),
              ) ??
              0,
        ),);
      } finally {
        await db.close();
      }
    }
    return stores;
  }

  /// Moves the unsynced changes of a quarantined database that were recorded
  /// for the signed-in account (and only those) into its queue. A change
  /// that was in conflict is queued again (its conflict may belong to the
  /// account that sent it). When no unsynced change is left, the
  /// quarantined database is removed (the rest are copies of server records,
  /// downloaded again by sync). Returns the number of changes recovered.
  Future<int> recoverFromQuarantine(String path) => _serialized(() async {
        final active = _active;
        final userId = _activeUserId;
        if (active == null || userId == null) throw const NoActiveAccountException();
        _checkQuarantinePath(path);
        final source = await DatabaseHelper.openAt(_factory, path);
        var recovered = 0;
        try {
          final rows = await source.query('pending_changes',
              where: 'synced = 0 AND user_id = ?', whereArgs: [userId], orderBy: 'created_at ASC',);
          await active.transaction((txn) async {
            for (final row in rows) {
              final values = Map<String, Object?>.from(row);
              if (values['status'] == 'conflict') {
                values['status'] = 'pending';
                values['conflict_id'] = null;
              }
              final inserted = await txn.insert('pending_changes', values, conflictAlgorithm: ConflictAlgorithm.ignore);
              if (inserted != 0) recovered++;
            }
          });
          for (final row in rows) {
            await source.delete('pending_changes', where: 'id = ?', whereArgs: [row['id']]);
          }
        } finally {
          await source.close();
        }
        final check = await DatabaseHelper.openAt(_factory, path);
        final left = await _unsynced(check);
        await check.close();
        if (left == 0) await _factory.deleteDatabase(path);
        return recovered;
      });

  /// Permanently removes a quarantined database, including any unsynced
  /// changes in it. [confirmed]: the person confirmed that loss.
  Future<void> deleteQuarantined(String path, {required bool confirmed}) => _serialized(() async {
        _checkQuarantinePath(path);
        if (!confirmed) throw StateError('Removing quarantined data needs the person\'s confirmation');
        // Refused while it holds changes recorded for another account than
        // the signed-in one: only that account may recover its work.
        int others = 0;
        try {
          final db = await DatabaseHelper.openAt(_factory, path);
          try {
            others = sqflite.Sqflite.firstIntValue(await db.rawQuery("SELECT COUNT(*) FROM pending_changes WHERE synced = 0 AND user_id <> '' AND user_id IS NOT ?", [_activeUserId])) ?? 0;
          } finally {
            await db.close();
          }
        } catch (_) {
          // Unreadable: nothing can be recovered from it; removable once confirmed.
        }
        if (others > 0) throw UnsyncedChangesException(others);
        await _factory.deleteDatabase(path);
      });

  void _checkQuarantinePath(String path) {
    if (!p.basename(path).startsWith('quarantine-') || p.basename(p.dirname(path)) != accountsDirName) {
      throw ArgumentError('not a quarantined database: $path');
    }
  }
}
