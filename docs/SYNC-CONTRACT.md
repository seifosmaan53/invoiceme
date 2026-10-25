# Sync contract (`/api/v1/sync`)

This document describes what the server **actually does** today
(`backend/src/sync/sync.service.ts`, `sync.controller.ts`) and how the Flutter
client (`mobile/lib/core/services/sync_service.dart`) uses it. Where behaviour
is surprising or arguably wrong, it is called out and listed under
[Known gaps](#known-gaps). Nothing here is aspirational: if a guarantee is not
listed, the server does not provide it.

## Authentication and ownership

- Both endpoints require a JWT (`JwtAuthGuard`). The acting user is
  `payload.sub` from the token. It is never taken from the request body.
- Every record created through sync is owned by the authenticated user.
  `userId` and `id` inside `data` are ignored. The record id is `object_id`.
- A change is applied only if everything it touches belongs to the
  authenticated user:

  | object_type    | target must be                         | references validated                         |
  |----------------|----------------------------------------|----------------------------------------------|
  | `client`       | a client with `userId` = user          | –                                            |
  | `invoice`      | an invoice with `userId` = user        | `clientId` must be the user's client         |
  | `invoice_item` | an item whose invoice is the user's    | `invoiceId` must be the user's invoice       |
  | `attachment`   | an attachment whose owner is the user's | `ownerType`/`ownerId` must be the user's invoice/client |

  References are checked on create and whenever `data` changes them. The
  check covers ownership only. A soft-deleted client or invoice of the same
  user is still a valid reference.
- Only real entity columns from `data` are applied. Relation objects (for
  example `client: {...}`) and unknown keys are dropped.

## POST /api/v1/sync/push

Request:

```json
{
  "deviceId": "mobile-device-abc123",
  "changes": [
    {
      "object_type": "client | invoice | invoice_item | attachment",
      "object_id": "<uuid>",
      "change_type": "create | update | delete",
      "data": { "name": "Acme" },
      "device_id": "optional, defaults to deviceId",
      "updated_at": "optional ISO-8601, currently unused"
    }
  ]
}
```

- The body is validated by the global `ValidationPipe`. A malformed body (for
  example an unknown `object_type`, or `data` that is not an object) rejects
  the **whole request** with `400` and applies nothing. The contents of `data`
  are not schema-validated. Invalid values there make that single change fail.
- Changes are processed **sequentially in array order**. Each one is
  independent: there is no transaction across the batch.
- For each change the server:
  1. inserts a `device_changes` row (`synced = false`) owned by the user,
  2. applies the change,
  3. marks the row `synced = true`.

  If step 2 throws, the row stays `synced = false` and the change counts as
  failed. Nothing on the server ever retries or replays `device_changes`. The
  table is an audit log only.
- Response: `200 { "synced": <n>, "failed": <m> }`, with `n + m =
  changes.length`. There are **no per-change results**.

### What counts as `failed`

A change is counted in `failed` and **not applied** when:

- it targets a record that exists but belongs to another user (update,
  delete, or a create that reuses another user's id),
- it references another user's client, invoice or attachment owner,
- it references a non-existent client or invoice,
- the database rejects it (missing NOT NULL column, invalid uuid, bad enum,
  and so on).

Ownership failures are deliberately indistinguishable from other failures in
the response. The server logs the reason.

### Create and update semantics

- `create` and `update` are both **upserts within the user's scope**. If
  `object_id` exists and is owned by the user, its fields are overwritten with
  `data`. If it does not exist anywhere, it is inserted. If it exists for
  another user, the change fails.
- Clients and invoices get `updatedAt = now()` (API server clock) on update.
- `deletedAt` is an ordinary column. A device can clear it on its own record,
  which un-deletes the record.

### Delete semantics

- Clients and invoices: **soft delete** (`deletedAt = now()`). Deleting an
  already soft-deleted record succeeds and refreshes `deletedAt`.
- Invoice items and attachments: **hard delete**.
- Deleting an id that does not exist anywhere is a **no-op success**, so
  retries stay idempotent. Deleting another user's id fails.

### Retries and duplicate operations

- There is no idempotency key. A retried batch is processed again from
  scratch. Each replay writes another `device_changes` row.
- Replaying the same create/update writes the same data again. The end
  state is the same, but `updatedAt` moves forward, so the record shows up
  again in the next incremental pull.
- Replaying a delete succeeds (see above).
- After a lost response the client cannot tell which changes were applied.
  Replaying the whole batch is safe under the rules above.

### Stale writes and conflicts

- **`updated_at` is ignored.** The server does no timestamp comparison,
  version check or conflict detection. Whichever write **arrives** last wins,
  whenever it was made offline. A device that comes back online after a week
  overwrites newer edits made on another device or through the REST API with
  its older data.
- This is *not* last-write-wins by client timestamp. The README sentence
  claiming that is inaccurate (see [Known gaps](#known-gaps)).

### Clock skew

- Device clocks do not affect push, because `updated_at` is unused.
- Pull compares the server-side `updatedAt` column with `since`. The client
  sends back the `lastSyncTimestamp` the server returned, so device clock
  skew does not matter for pull. But `updatedAt` is set from the API server
  clock on sync updates and from the database clock (`@UpdateDateColumn`) on
  inserts and REST saves, so skew between API instances and the database can
  make incremental pulls skip or repeat rows.

## GET /api/v1/sync/pull?since=<ISO-8601>

- Returns the user's non-deleted clients and invoices with
  `updatedAt > since` (all of them if `since` is omitted). It also returns the
  invoice items of those invoices, and the attachments of those invoices and
  clients.
- Invoices include their `client` relation, but only when that client is
  the user's. Push and REST both require it; for cross-owner rows created
  **before** the fix, `client` is `null` (see the audit query in
  `docs/security/2026-10-25-sync-ownership.md`).
- `lastSyncTimestamp` is the server time **after** the queries ran.

## Client behaviour (Flutter)

- Pending changes are queued in local SQLite (`pending_changes`) and pushed
  in `created_at` order.
- After a push, the client marks the **first `synced`** pending changes as
  synced (`pendingChanges.take(synced)`). The server returns counts only, so
  this is wrong whenever a failed change is not at the end of the batch (see
  gaps).
- Pulled rows are upserted locally with `ConflictAlgorithm.replace`.

## Known gaps

These are follow-ups. They are intentionally not changed here, because each
needs a product decision:

1. **No conflict handling / stale writes.** Arrival order wins. Fixing this
   needs a policy (per-record version, server-side LWW on a trusted clock,
   or conflict surfacing).
2. **Counts-only push result + client `take(synced)`.** When a change fails
   mid-batch, the client marks the wrong changes as synced and keeps retrying
   a change that already succeeded. A per-change result (for example
   `results: [{object_id, status}]`) plus a client update would fix this.
3. **Deletions do not propagate through pull.** Soft-deleted rows are
   filtered out, and hard-deleted items/attachments vanish, so other devices
   never learn about a delete. Needs tombstones or a deleted-ids list.
4. **Incremental pull misses item/attachment-only changes.** Items and
   attachments have no `updatedAt`. They are returned only when their parent
   invoice/client is, and editing an item through sync does not bump the
   invoice.
5. **Pull timestamp window.** `lastSyncTimestamp` is taken after the
   queries, so rows committed between the query and that moment are skipped
   by the next incremental pull. Capturing the timestamp before querying (and
   tolerating duplicates) would close this.
6. **No batch size limit** on `changes`.
7. `docs/API.md` and the README described a different payload and
   last-write-wins semantics. `docs/API.md` now points here. The README
   sentence still needs rewording.
