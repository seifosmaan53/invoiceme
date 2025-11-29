// Dart imports
import 'dart:async';

// Flutter imports
import 'package:flutter/foundation.dart' show debugPrint, kIsWeb;

import 'package:sqflite/sqflite.dart';

import 'package:path/path.dart';

import 'package:path_provider/path_provider.dart';

class DatabaseHelper {
  static Database? _database;

  static Future<Database> getDatabase() async {
    if (_database != null) return _database!;

    final path = await _getDatabasePath();
    _database = await openDatabase(
      path,
      version: 2, // Incremented to trigger onUpgrade
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
        deleted_at TEXT
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
        deleted_at TEXT
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
        created_at TEXT NOT NULL
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
        created_at TEXT NOT NULL
      );
    ''');
  }

  static Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    if (oldVersion < 2) {
      // Add avatar_url column to clients_local table
      try {
        await db.execute('ALTER TABLE clients_local ADD COLUMN avatar_url TEXT');
      } catch (e) {
        // Column might already exist, ignore error
        debugPrint('Note: avatar_url column may already exist: $e');
      }
    }
  }
}
