// Dart imports
import 'dart:convert';

// Package imports
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

// Local imports - Core
import '../database/database_helper.dart';
import '../services/api_client.dart';

// Local imports - Models
import '../../models/attachment.dart';
import '../../models/client.dart';
import '../../models/invoice.dart';
import '../../models/invoice_item.dart';

enum ChangeType { create, update, delete }

enum ChangeObjectType { client, invoice, invoice_item, attachment }

/// Change object format: {object_type, object_id, change_type, data, device_id, updated_at}
class ChangeObject {
  final ChangeObjectType objectType;
  final String objectId;
  final ChangeType changeType;
  final Map<String, dynamic> data;
  final String deviceId;
  final String updatedAt;

  ChangeObject({
    required this.objectType,
    required this.objectId,
    required this.changeType,
    required this.data,
    required this.deviceId,
    required this.updatedAt,
  });

  Map<String, dynamic> toJson() {
    return {
      'object_type': objectType.name,
      'object_id': objectId,
      'change_type': changeType.name,
      'data': data,
      'device_id': deviceId,
      'updated_at': updatedAt,
    };
  }
}

class SyncService {
  final ApiClient _apiClient;
  final DatabaseHelper _dbHelper;
  final String _deviceId;

  SyncService(this._apiClient, this._dbHelper) : _deviceId = const Uuid().v4();

  /// Perform full sync: push pending changes, then pull server updates
  Future<void> sync() async {
    try {
      // Push pending changes
      await _pushChanges();

      // Pull server changes
      await _pullChanges();
    } catch (e) {
      debugPrint('Sync error: $e');
      rethrow;
    }
  }

  /// Push pending changes from local database to server
  Future<void> _pushChanges() async {
    final db = await DatabaseHelper.getDatabase();

    // Get unsynced changes
    final pendingChanges = await db.query(
      'pending_changes',
      where: 'synced = ?',
      whereArgs: [0],
      orderBy: 'created_at ASC',
    );

    if (pendingChanges.isEmpty) return;

    // Convert to ChangeObject format
    final changes = pendingChanges.map((change) {
      return ChangeObject(
        objectType: ChangeObjectType.values.firstWhere(
          (e) => e.name == change['object_type'] as String,
        ),
        objectId: change['object_id'] as String,
        changeType: ChangeType.values.firstWhere(
          (e) => e.name == change['change_type'] as String,
        ),
        data: jsonDecode(change['change_json'] as String),
        deviceId: change['device_id'] as String,
        updatedAt: change['created_at'] as String,
      ).toJson();
    }).toList();

    try {
      final response = await _apiClient.post('/sync/push', data: {
        'deviceId': _deviceId,
        'changes': changes,
      });

      final result = response.data as Map<String, dynamic>;
      final synced = result['synced'] as int? ?? 0;
      final failed = result['failed'] as int? ?? 0;

      debugPrint('Sync push: $synced synced, $failed failed');

      // Mark successfully synced changes
      if (synced > 0) {
        final syncedIds = pendingChanges.take(synced).map((c) => c['id'] as String).toList();
        for (final id in syncedIds) {
          await db.update(
            'pending_changes',
            {'synced': 1},
            where: 'id = ?',
            whereArgs: [id],
          );
        }
      }
    } catch (e) {
      debugPrint('Push changes error: $e');
      rethrow;
    }
  }

  /// Pull changes from server and update local database
  Future<void> _pullChanges() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final lastSync = prefs.getString('last_sync_timestamp');

      final response = await _apiClient.get(
        '/sync/pull',
        queryParameters: lastSync != null ? {'since': lastSync} : null,
      );

      final data = response.data as Map<String, dynamic>;
      final db = await DatabaseHelper.getDatabase();

      // Update clients
      if (data['clients'] != null) {
        final clients = (data['clients'] as List).map((json) => Client.fromJson(json)).toList();
        for (final client in clients) {
          await _upsertClient(db, client);
        }
        debugPrint('Pulled ${clients.length} clients');
      }

      // Update invoices
      if (data['invoices'] != null) {
        final invoices = (data['invoices'] as List).map((json) => Invoice.fromJson(json)).toList();
        for (final invoice in invoices) {
          await _upsertInvoice(db, invoice);
        }
        debugPrint('Pulled ${invoices.length} invoices');
      }

      // Update invoice items
      if (data['invoiceItems'] != null) {
        final items = (data['invoiceItems'] as List).map((json) => InvoiceItem.fromJson(json)).toList();
        for (final item in items) {
          await _upsertInvoiceItem(db, item);
        }
        debugPrint('Pulled ${items.length} invoice items');
      }

      // Update attachments
      if (data['attachments'] != null) {
        final attachments = (data['attachments'] as List).map((json) => Attachment.fromJson(json)).toList();
        for (final attachment in attachments) {
          await _upsertAttachment(db, attachment);
        }
        debugPrint('Pulled ${attachments.length} attachments');
      }

      // Update last sync timestamp
      await prefs.setString('last_sync_timestamp', data['lastSyncTimestamp'] as String);
      debugPrint('Sync completed at ${data['lastSyncTimestamp']}');
    } catch (e) {
      debugPrint('Pull changes error: $e');
      rethrow;
    }
  }

  Future<void> _upsertClient(Database db, Client client) async {
    await db.insert(
      'clients_local',
      client.toDatabaseMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> _upsertInvoice(Database db, Invoice invoice) async {
    await db.insert(
      'invoices_local',
      invoice.toDatabaseMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> _upsertInvoiceItem(Database db, InvoiceItem item) async {
    await db.insert(
      'invoice_items_local',
      item.toDatabaseMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> _upsertAttachment(Database db, Attachment attachment) async {
    await db.insert(
      'attachments_local',
      attachment.toDatabaseMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Queue a change for sync
  /// Format: {object_type, object_id, change_type, data, device_id, updated_at}
  Future<void> queueChange({
    required ChangeObjectType objectType,
    required String objectId,
    required ChangeType changeType,
    required Map<String, dynamic> data,
  }) async {
    final db = await DatabaseHelper.getDatabase();
    final prefs = await SharedPreferences.getInstance();
    final userId = prefs.getString('user_id') ?? '';

    await db.insert('pending_changes', {
      'id': const Uuid().v4(),
      'user_id': userId,
      'device_id': _deviceId,
      'object_type': objectType.name,
      'object_id': objectId,
      'change_json': jsonEncode(data),
      'change_type': changeType.name,
      'synced': 0,
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  /// Get device ID
  String get deviceId => _deviceId;
}

