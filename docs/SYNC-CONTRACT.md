# Sync contract (`/api/v1/sync`)

This document describes what the server **actually does** today
(`backend/src/sync/sync.service.ts`, `sync.controller.ts`) and how the Flutter
client (`mobile/lib/core/services/sync_service.dart`) uses it. Where behaviour
is surprising or arguably wrong, it is called out and listed under
[Known gaps](#known-gaps). Nothing here is aspirational: if a guarantee is not
listed, the server does not provide it. Behaviour marked *tested* is covered
by `backend/test/sync-contract.e2e-spec.ts` (real PostgreSQL) unless another
suite is named.

Conflict handling (stale offline edits) is **not** implemented. The design
options and the decisions the owner has to make are in
[proposals/sync-conflicts.md](proposals/sync-conflicts.md).

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
  user is still a valid reference. (*Tested* in
  `sync-ownership.e2e-spec.ts`.)
- Only real entity columns from `data` are applied. Relation objects (for
  example `client: {...}`) and unknown keys are dropped.

## POST /api/v1/sync/push

Request:

```json
{
  "deviceId": "mobile-device-abc123",
  "changes": [
    {
      "change_id": "optional UUID, unique per change on the device",
      "object_type": "client | invoice | invoice_item | attachment",
      "object_id": "<uuid>",
      "change_type": "create | update | delete",
      "data": { "name": "Acme" },
      "device_id": "optional, defaults to deviceId",
      "updated_at": "optional ISO-8601, ignored"
    }
  ]
}
```

- The body is validated by the global `ValidationPipe` (whitelist +
  `forbidNonWhitelisted`). A malformed body (for example an unknown
  `object_type`, `data` that is not an object, or a `change_id` that is not
  a UUID) rejects the **whole request** with `400` and applies nothing. The
  contents of `data` are not schema-validated. Invalid values there make that
  single change fail.
- An unknown field anywhere in a change is a `400`. A client that sends
  `change_id` to a server **older** than this contract therefore gets `400`
  for every push (see [Compatibility](#compatibility-and-rollout)).

### Processing order and atomicity

- Changes are processed **sequentially in array order**. Each change is
  applied in **its own database transaction**. There is no transaction across
  the batch, and a failed change does not stop the rest (*tested*).
- For each change the server, inside that transaction:
  1. takes a transaction-scoped lock on (`object_type`, `object_id`), so
     changes to the same object are applied one at a time even when they
     arrive in concurrent requests,
  2. records the change in `device_changes` (or, for a known `change_id`,
     locks the existing row; see [Replays](#replays-and-duplicate-delivery)),
  3. applies it,
  4. marks the row `synced = true`.

  If step 3 fails, only step 3 is rolled back (savepoint). The
  `device_changes` row stays with `synced = false`, and the change is
  reported `failed`. A failed change leaves no partial write (*tested*).
- Nothing on the server ever retries or replays `device_changes` by itself.
  The table is an audit log and the idempotency record.

### Response and acknowledgements

```json
{
  "synced": 2,
  "failed": 1,
  "results": [
    { "index": 0, "change_id": "…", "object_type": "client",  "object_id": "…", "status": "applied" },
    { "index": 1, "change_id": "…", "object_type": "invoice", "object_id": "…", "status": "failed" },
    { "index": 2, "change_id": null, "object_type": "client", "object_id": "…", "status": "applied" }
  ]
}
```

- `results` has exactly one entry per request change, in request order.
  `index` is the position in `changes`. `change_id` echoes the request value
  or is `null`.
- `status`:
  - `applied`: applied by this request.
  - `duplicate`: this `change_id` was already applied by an earlier request
    for this user. Nothing was written. The change is done, so acknowledge
    it.
  - `failed`: not applied. Resending it retries it.
- `synced` = applied + duplicate, `failed` = failed, and `synced + failed =
  changes.length`. These two fields are unchanged from earlier versions, for
  clients that read only the counts.
- **A client must acknowledge changes by `results[].index` (or
  `change_id`), never by taking the first `synced` changes.** The counts do
  not say which change failed (*tested*). The current mobile client still uses
  the counts; see [Client behaviour](#client-behaviour-flutter).

### What counts as `failed`

A change is reported `failed` and **not applied** when:

- it targets a record that exists but belongs to another user (update,
  delete, or a create that reuses another user's id),
- it references another user's client, invoice or attachment owner,
- it references a non-existent client or invoice (for example a child sent
  before its parent; see [Ordering](#ordering-of-related-records)),
- the database rejects it (missing NOT NULL column, invalid uuid, bad enum,
  and so on),
- its `change_id` was already recorded for this user with **different**
  contents (`object_type`, `object_id`, `change_type` or `data`) (*tested*).

Ownership failures are deliberately indistinguishable from other failures in
the response. The server logs the reason.

### Replays and duplicate delivery

**With `change_id`** (idempotent):

- A (user, `change_id`) pair is applied **at most once**. The unique index
  `idx_device_changes_user_change_id` (migration 018) enforces this even for
  concurrent requests: a second delivery waits for the first to commit and is
  then answered `duplicate` (*tested*: three concurrent deliveries of the same
  batch apply each change once).
- Retrying a whole batch after a lost response is safe. Applied changes come
  back `duplicate`, nothing is re-applied, and `updatedAt` does not move
  (*tested*). In particular, a replayed old update does not overwrite a newer
  edit, and a replayed create does not resurrect a deleted item (*tested*).
- A previously `failed` change is retried when its `change_id` is sent again.
  If it succeeds now it is applied (still one audit row per `change_id`, now
  `synced = true`); otherwise it is reported `failed` again (*tested*).
- `change_id`s are scoped per user. Another user sending the same value is an
  unrelated change and learns nothing about the first (*tested*).

**Without `change_id`** (current mobile client, old clients):

- There is no replay protection. A resent change is a new change and is
  applied again. Each resend writes another `device_changes` row.
- Replaying a create/update writes the same data again. That is harmless only
  if nothing changed the record in between. A replayed old update **does**
  overwrite a newer edit, and a replayed item/attachment create **does**
  re-create a row deleted in the meantime (*tested*, pinned as the documented
  limitation).
- Replaying a delete succeeds (see below).

### Retry after a partial batch failure

With `change_id`, resending the same batch is predictable. Changes that were
applied before come back `duplicate` (not re-applied, so edits made since are
kept), and only the failed ones are attempted again, in the same relative
order (*tested*). A change that fails permanently keeps failing on every
retry and does not block the other changes (*tested*). The client has to
decide what to do with it (see the proposal, decision D5).

Without `change_id`, a resend re-applies every change in the batch.

### Create and update semantics

- `create` and `update` are both **upserts within the user's scope**. If
  `object_id` exists and is owned by the user, the fields present in `data`
  are overwritten. If it does not exist anywhere, it is inserted. If it exists
  for another user, the change fails.
- Clients and invoices get `updatedAt = now()` (API server clock) on update.
- `deletedAt` is an ordinary column. A device can clear it on its own record,
  which un-deletes the record (*tested*).
- A `create` for an id the same user soft-deleted is an **update** of the
  deleted row: it stays deleted unless `data` clears `deletedAt`. Another
  user can never take over a soft-deleted id (*tested*).

### Delete semantics

- Clients and invoices: **soft delete** (`deletedAt = now()`). Deleting an
  already soft-deleted record succeeds and refreshes `deletedAt`. Deleting a
  client or invoice does not touch its invoices, items or attachments.
- Invoice items and attachments: **hard delete**.
- Deleting an id that does not exist anywhere is a **no-op success**, so
  retries stay idempotent. Deleting another user's id fails.
- After a hard delete the id is free. If another user later creates a record
  with that id, stale edits and deletes from the first user's devices fail
  and do not touch it (*tested*).

### Ordering of related records

- There is no dependency resolution. A child (invoice, item, attachment) sent
  before its parent fails because the reference does not exist yet, while the
  parent is applied. Resending the child succeeds (*tested*). Clients should
  send parents first. The mobile client does, as long as the user created
  them in that order (queue order = creation order).
- Edits to children of a soft-deleted parent of the same user are accepted.

### Concurrent updates

- Changes to the same (`object_type`, `object_id`) are serialized by a
  transaction-scoped PostgreSQL advisory lock, whichever request they arrive
  in. Each change is applied as a whole against the latest committed state.
- Outcome: concurrent updates of **different fields** are all kept
  (*tested*; before this change one of them could be lost). For concurrent
  updates of the **same field**, both are reported `applied` and the one
  applied last remains. A record never ends up with a mix of the two changes'
  fields (*tested*). Which one is applied last depends on the order in which
  the server acquires the lock, not on a device timestamp.
- Writes through the REST API do not take this lock. A REST save and a sync
  update of the same record at the same instant behave as before: the later
  database write wins, per column TypeORM decides to write.

### Stale writes and conflicts

- **`updated_at` is ignored.** The server does no timestamp comparison,
  version check or conflict detection. Whichever write is **applied** last
  wins, whenever it was made offline (*tested*: a change stamped 2000 that
  arrives after one stamped 2099 wins). A device that comes back online after
  a week overwrites newer edits made on another device or through the REST
  API with its older data.
- This is *not* last-write-wins by client timestamp, and must not be
  described as such. Making stale edits detectable needs a protocol change;
  see [proposals/sync-conflicts.md](proposals/sync-conflicts.md).

### Clock skew

- Device clocks do not affect push, because `updated_at` is unused.
- Pull compares the server-side `updatedAt` column with `since`. The client
  sends back the `lastSyncTimestamp` the server returned, so device clock
  skew does not matter for pull. But `updatedAt` is set from the API server
  clock on sync updates and from the database clock (`@UpdateDateColumn`) on
  inserts and REST saves, so skew between API instances and the database can
  make incremental pulls skip or repeat rows.

## GET /api/v1/sync/pull?since=<ISO-8601>

Unchanged by this contract revision.

- Returns the user's non-deleted clients and invoices with
  `updatedAt > since` (all of them if `since` is omitted). It also returns the
  invoice items of those invoices, and the attachments of those invoices and
  clients.
- Invoices include their `client` relation, but only when that client is
  the user's. Push and REST both require it. For cross-owner rows created
  **before** the fix, `client` is `null` (see the audit query in
  `docs/security/2026-10-25-sync-ownership.md`).
- `lastSyncTimestamp` is the server time **after** the queries ran.

## Client behaviour (Flutter)

The released client (`mobile/lib/core/services/sync_service.dart` as of
`cac08e1`):

- Pending changes are queued in local SQLite (`pending_changes`, one row
  per mutation with a local random `id`) and the **whole queue** is pushed in
  one request, in `created_at` order. The local row `id` is not sent, so the
  released client gets **no replay protection**.
- `updated_at` is the time the change was queued, from the device clock.
- `deviceId` is a fresh random UUID per `SyncService` instance (that is, per
  app start), not a stable device identity. Do not rely on it for anything
  beyond the audit log.
- `sync()` pushes, then pulls. A push error (network, 4xx/5xx) aborts the
  sync. Nothing is marked synced, so the next sync resends the whole queue.
- After a push, the client marks the **first `synced`** pending changes as
  synced (`pendingChanges.take(synced)`). When a change in the middle fails,
  this marks the failed change as synced (it is never sent again and the
  device does not report it) and leaves a later, applied change pending (it
  is sent again and, without `change_id`, re-applied). The server cannot
  correct this for clients that ignore `results`.
- Pulled rows are upserted locally with `ConflictAlgorithm.replace`.

A backward-compatible client change is a separate commit on the
`fix/sync-contract` branch and **needs a mobile release**. It sends
`change_id` = the local row id, marks rows from `results`, and falls back to
the old behaviour when `results` is absent. Against an older server, which
rejects `change_id` with `400` and applies nothing, it resends once without
`change_id`. That matters because self-hosted installations update at
different times. Its Dart code and test were not compiled or run in the
environment that wrote it. CI runs the test (`flutter test test/services/`).

## Compatibility and rollout

| server \ client              | released client (no `change_id`) | client sending `change_id` |
|------------------------------|----------------------------------|----------------------------|
| before this change           | as before                        | `400` (`forbidNonWhitelisted`, nothing applied); the client on this branch resends without `change_id` = old behaviour |
| with this change + migration 018 | works with the same counts, ignores the extra `results`, no replay protection | idempotent, exact acknowledgements |

- Deploy order: **database migration 018 → server → mobile release.** A
  client release that sends `change_id` **without** the 400 fallback must
  not ship before every server it talks to has been updated.
- Migration 018 (`backend/migrations/018_add_device_change_change_id.sql`)
  adds the nullable `device_changes.change_id` column and the partial unique
  index `idx_device_changes_user_change_id (user_id, change_id) WHERE
  change_id IS NOT NULL`. It is additive and idempotent and changes no data.
  Before changing anything it counts duplicate (user_id, change_id) groups.
  These can exist only if the column was added earlier without the index,
  for example by TypeORM synchronize. If there are any, it stops with
  `migration 018: device_changes has N duplicate (user_id, change_id)
  group(s); unique index not created and no data changed`. Resolving those is
  a manual decision. Run it like the others with
  `psql -v ON_ERROR_STOP=1 --single-transaction`. Tested in
  `backend/test/sync-migration-018.e2e-spec.ts`.
- The server code needs the column. Do not start this server version against
  a database without migration 018, or every push will fail.
- Rollback: the previous server version ignores the column and the index, so
  they can stay. A client sending `change_id` must then be held back, because
  the old server rejects the field.
- The integrity report's schema fingerprint includes a marker for migration 018
  (`device_changes.change_id`).

## Known gaps

These are follow-ups. They are intentionally not changed here, because each
needs a product decision or a client release:

1. **No conflict handling / stale writes.** Apply order wins. Needs a policy;
   see [proposals/sync-conflicts.md](proposals/sync-conflicts.md).
2. **The released mobile client ignores `results` and sends no
   `change_id`.** Until the client change ships, a mid-batch failure is
   acknowledged as applied on the device and replays are not idempotent. The
   server side is ready.
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
6. **No batch size limit** on `changes`. A large queue is one long request
   with one transaction per change.
7. **Permanently failing changes** are retried forever by a client that
   resends failed changes. There is no reason code to tell "fix the data"
   from "retry later" (proposal, decision D5).
