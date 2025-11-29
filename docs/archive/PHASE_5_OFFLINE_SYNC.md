# Phase 5 - Offline / Sync: Complete

## Overview

Phase 5 implements offline-first synchronization for mobile devices. Changes made offline are queued locally and synced to the server when online. The server also pushes updates to devices based on timestamps.

## ✅ Completed Components

### 1. Change Object Format

**Format:** `{object_type, object_id, change_type, data, device_id, updated_at}`

**TypeScript Interface:**
```typescript
interface ChangeObject {
  object_type: ChangeObjectType;  // 'client' | 'invoice' | 'invoice_item' | 'attachment'
  object_id: string;               // UUID of the object
  change_type: ChangeType;         // 'create' | 'update' | 'delete'
  data: Record<string, any>;       // Object data (serialized)
  device_id: string;               // UUID of the device
  updated_at: string;              // ISO 8601 timestamp
}
```

**Example:**
```json
{
  "object_type": "client",
  "object_id": "123e4567-e89b-12d3-a456-426614174000",
  "change_type": "create",
  "data": {
    "name": "Acme Corp",
    "email": "contact@acme.com",
    "phone": "+1234567890"
  },
  "device_id": "device-uuid-123",
  "updated_at": "2024-01-01T12:00:00.000Z"
}
```

### 2. POST /v1/sync/push

**Endpoint:** `POST /api/v1/sync/push`

**Purpose:** Accept array of changes from mobile device and apply them to the server.

**Request Body:**
```json
{
  "deviceId": "device-uuid-123",
  "changes": [
    {
      "object_type": "client",
      "object_id": "123e4567-e89b-12d3-a456-426614174000",
      "change_type": "create",
      "data": { "name": "Acme Corp", "email": "contact@acme.com" },
      "device_id": "device-uuid-123",
      "updated_at": "2024-01-01T12:00:00.000Z"
    }
  ]
}
```

**Response:**
```json
{
  "synced": 5,
  "failed": 0
}
```

**Process:**
1. Receives array of changes from device
2. Creates device_change records for each change
3. Processes each change (create/update/delete)
4. Marks successfully processed changes as synced
5. Returns count of synced and failed changes

**Supported Object Types:**
- `client` - Client records
- `invoice` - Invoice/Estimate records
- `invoice_item` - Invoice line items
- `attachment` - Attachment records

**Change Types:**
- `create` - Create new record
- `update` - Update existing record
- `delete` - Soft delete record

**Error Handling:**
- Individual change failures don't stop the batch
- Failed changes are logged but not marked as synced
- Returns count of successfully synced changes

### 3. GET /v1/sync/pull

**Endpoint:** `GET /api/v1/sync/pull?since=2024-01-01T12:00:00.000Z`

**Purpose:** Return all changes from server after the given timestamp.

**Query Parameters:**
- `since` (optional): ISO 8601 timestamp. If omitted, returns all records.

**Response:**
```json
{
  "clients": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "user_id": "user-uuid",
      "name": "Acme Corp",
      "email": "contact@acme.com",
      "phone": "+1234567890",
      "address_json": null,
      "created_at": "2024-01-01T12:00:00.000Z",
      "updated_at": "2024-01-01T12:00:00.000Z",
      "deleted_at": null
    }
  ],
  "invoices": [
    {
      "id": "invoice-uuid",
      "user_id": "user-uuid",
      "client_id": "client-uuid",
      "type": "invoice",
      "number": "INV-2024-0001",
      "status": "draft",
      "issue_date": "2024-01-01",
      "due_date": "2024-01-31",
      "currency": "USD",
      "subtotal": 1000.00,
      "tax_total": 100.00,
      "discount_total": 0.00,
      "total": 1100.00,
      "notes": null,
      "metadata_json": null,
      "created_at": "2024-01-01T12:00:00.000Z",
      "updated_at": "2024-01-01T12:00:00.000Z",
      "deleted_at": null,
      "client": { ... }
    }
  ],
  "invoiceItems": [
    {
      "id": "item-uuid",
      "invoice_id": "invoice-uuid",
      "description": "Service",
      "quantity": 1,
      "unit_price": 1000.00,
      "tax_rate": 0.10,
      "discount_rate": 0.00,
      "line_total": 1100.00,
      "created_at": "2024-01-01T12:00:00.000Z"
    }
  ],
  "attachments": [],
  "lastSyncTimestamp": "2024-01-01T12:00:00.000Z"
}
```

**Process:**
1. Filters clients and invoices by `updated_at > since`
2. Includes invoice items for returned invoices
3. Includes attachments for returned invoices and clients
4. Returns all data with `lastSyncTimestamp` for next sync

**Filtering:**
- Only returns non-deleted records (`deleted_at IS NULL`)
- Only returns records updated after the timestamp
- Ordered by `updated_at ASC` for consistent ordering

### 4. Flutter Sync Service

**Location:** `mobile/lib/core/services/sync_service.dart`

**Features:**
- ✅ Push pending changes to server
- ✅ Pull server updates
- ✅ Queue changes for offline sync
- ✅ Change object format matching server spec
- ✅ Error handling and logging

**ChangeObject Class:**
```dart
class ChangeObject {
  final ChangeObjectType objectType;
  final String objectId;
  final ChangeType changeType;
  final Map<String, dynamic> data;
  final String deviceId;
  final String updatedAt;
}
```

**Sync Methods:**

1. **`sync()`** - Full sync (push then pull)
   ```dart
   await syncService.sync();
   ```

2. **`queueChange()`** - Queue a change for sync
   ```dart
   await syncService.queueChange(
     objectType: ChangeObjectType.client,
     objectId: clientId,
     changeType: ChangeType.create,
     data: client.toJson(),
   );
   ```

**Sync Flow:**

1. **Push Phase:**
   - Reads unsynced changes from `pending_changes` table
   - Converts to ChangeObject format
   - Sends to `/v1/sync/push`
   - Marks successfully synced changes

2. **Pull Phase:**
   - Gets last sync timestamp from SharedPreferences
   - Calls `/v1/sync/pull` with timestamp
   - Upserts clients, invoices, and items to local DB
   - Updates last sync timestamp

**Local Database Tables:**
- `pending_changes` - Queued changes waiting for sync
- `clients_local` - Local client cache
- `invoices_local` - Local invoice cache
- `invoice_items_local` - Local invoice items cache

**Usage Example:**

```dart
// Create a client offline
final client = Client(
  id: Uuid().v4(),
  name: 'Acme Corp',
  email: 'contact@acme.com',
);

// Save to local DB
await db.insert('clients_local', client.toDatabaseMap());

// Queue change for sync
await syncService.queueChange(
  objectType: ChangeObjectType.client,
  objectId: client.id,
  changeType: ChangeType.create,
  data: client.toJson(),
);

// Later, when online, sync
await syncService.sync();
```

## Sync Strategy

### Offline-First Approach

1. **Local Operations:**
   - All CRUD operations write to local database first
   - Changes are queued in `pending_changes` table
   - App works fully offline

2. **Sync Process:**
   - Push: Send queued changes to server
   - Pull: Get server updates since last sync
   - Merge: Upsert server data into local database

3. **Conflict Resolution:**
   - Last write wins (server timestamp)
   - Uses `updated_at` to determine latest version
   - Server data overwrites local on conflict

### Change Processing

**Create:**
- If object doesn't exist, create it
- If object exists, update it (merge)

**Update:**
- Update existing object
- Merge data fields

**Delete:**
- Soft delete (set `deleted_at`)

## Testing

### Test Push Sync

```bash
curl -X POST http://localhost:3000/api/v1/sync/push \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-123",
    "changes": [
      {
        "object_type": "client",
        "object_id": "123e4567-e89b-12d3-a456-426614174000",
        "change_type": "create",
        "data": {
          "name": "Test Client",
          "email": "test@example.com"
        },
        "device_id": "test-device-123",
        "updated_at": "2024-01-01T12:00:00.000Z"
      }
    ]
  }'
```

### Test Pull Sync

```bash
curl -X GET "http://localhost:3000/api/v1/sync/pull?since=2024-01-01T00:00:00.000Z" \
  -H "Authorization: Bearer {token}"
```

## Phase 5 Checklist

- ✅ Change object format defined: `{object_type, object_id, change_type, data, device_id, updated_at}`
- ✅ POST /v1/sync/push accepts array of changes
- ✅ POST /v1/sync/push processes changes and marks as synced
- ✅ GET /v1/sync/pull returns changes after timestamp
- ✅ GET /v1/sync/pull filters by updated_at
- ✅ Flutter sync service pushes pending changes
- ✅ Flutter sync service pulls server updates
- ✅ Flutter sync service queues changes for offline sync
- ✅ Error handling and logging
- ✅ Swagger documentation

## Next Steps

Phase 5 is complete. Ready for:
- Phase 6: Email Notifications
- Phase 7: Mobile UI Implementation
- Phase 8: Advanced Features

All offline sync functionality is implemented and ready for production use.

