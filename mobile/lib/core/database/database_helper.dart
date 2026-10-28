// Dart imports
import 'dart:async';

// Flutter imports
import 'package:flutter/foundation.dart' show kIsWeb;

import 'package:sqflite/sqflite.dart';

import 'package:path/path.dart';

import 'package:path_provider/path_provider.dart';

class DatabaseHelper {
  static Database? _database;

  /// 3: sync protocol 2 (record revisions; base revision, status and conflict
  /// id on queued changes).
  static const int schemaVersion = 4;

  static Future<Database> getDatabase() async {
    if (_database != null) return _database!;

    final path = await _getDatabasePath();
    _database = await openDatabase(
      path,
      version: schemaVersion,
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
    );
    return _database!;
  }

  static Future<String> _getDatabasePath() async {
    if (kIsWeb) {
      return 'invoiceme.db'; // Web: in-memory fallback
    } else {
      final dir = await getApplicationDocumentsDirectory();
      return join(dir.path, 'invoiceme.db');
    }
  }

  static Future<void> _onCreate(Database db, int version) async {
    // Clients table for offline cache (matches toDatabaseMap/fromDatabaseMap)
    await db.execute('''
      CREATE TABLE IF NOT EXISTS clients_local (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        address_json TEXT,
        notes TEXT,
        tags_json TEXT,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        revision INTEGER
      );
    ''');

    // Invoices table for offline cache (matches Invoice.toDatabaseMap)
    await db.execute('''
      CREATE TABLE IF NOT EXISTS invoices_local (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        type TEXT NOT NULL,
        number TEXT NOT NULL,
        status TEXT NOT NULL,
        issue_date TEXT NOT NULL,
        due_date TEXT,
        currency TEXT NOT NULL,
        subtotal REAL NOT NULL,
        tax_total REAL NOT NULL,
        discount_total REAL NOT NULL,
        total REAL NOT NULL,
        notes TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        revision INTEGER
      );
    ''');

    // Invoice items table for offline cache (matches InvoiceItem.toDatabaseMap)
    await db.execute('''
      CREATE TABLE IF NOT EXISTS invoice_items_local (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        description TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        tax_rate REAL NOT NULL,
        discount_rate REAL NOT NULL,
        line_total REAL NOT NULL,
        created_at TEXT NOT NULL,
        revision INTEGER
      );
    ''');

    // Attachments table for offline cache
    await db.execute('''
      CREATE TABLE IF NOT EXISTS attachments_local (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        url TEXT NOT NULL,
        filename TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    ''');

    // Pending changes queue for offline sync
    await db.execute('''
      CREATE TABLE IF NOT EXISTS pending_changes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        object_type TEXT NOT NULL,
        object_id TEXT NOT NULL,
        change_type TEXT NOT NULL,
        change_json TEXT NOT NULL,
        synced INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        base_revision INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        conflict_id TEXT,
        last_reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        parent_id TEXT,
        parent_base_revision INTEGER,
        last_result TEXT
      );
    ''');
  }

  static Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    // Every step checks the existing columns, so running it twice (or on a
    // database that already has a column) changes nothing.
    if (oldVersion < 2) {
      await _addColumnIfMissing(db, 'clients_local', 'avatar_url', 'TEXT');
    }
    // Version 4 repeats the version-3 steps: builds of the unreleased protocol-2
    // branch created version 3 before every pending_changes column existed.
    if (oldVersion < 4) {
      for (final table in ['clients_local', 'invoices_local', 'invoice_items_local']) {
        await _addColumnIfMissing(db, table, 'revision', 'INTEGER');
      }
      for (final column in v3PendingChangeColumns.entries) {
        await _addColumnIfMissing(db, 'pending_changes', column.key, column.value);
      }
    }
  }

  /// Columns version 3 adds to pending_changes.
  static const Map<String, String> v3PendingChangeColumns = {
    'base_revision': 'INTEGER',
    'status': "TEXT NOT NULL DEFAULT 'pending'",
    'conflict_id': 'TEXT',
    'last_reason': 'TEXT',
    // Failed attempts with a server reason (given up at 3, see sync_protocol.dart).
    'attempts': 'INTEGER NOT NULL DEFAULT 0',
    // Invoice items: the item's invoice and its revision when queued (sent as parent_revision).
    'parent_id': 'TEXT',
    'parent_base_revision': 'INTEGER',
    // What is known about the last send (see sync_protocol.dart rebaseModeOf).
    'last_result': 'TEXT',
  };

  static Future<void> _addColumnIfMissing(Database db, String table, String column, String definition) async {
    final columns = await db.rawQuery('PRAGMA table_info($table)');
    if (columns.any((c) => c['name'] == column)) return;
    await db.execute('ALTER TABLE $table ADD COLUMN $column $definition');
  }
}
