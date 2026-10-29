# Sync contract (`/api/v1/sync`)

This document describes what the server **actually does** today
(`backend/src/sync/sync.service.ts`, `sync.controller.ts`) and how the Flutter
client (`mobile/lib/core/services/sync_service.dart`) uses it. Where behaviour
is surprising or arguably wrong, it is called out and listed under
[Known gaps](#known-gaps). Nothing here is aspirational: if a guarantee is not
listed, the server does not provide it. Behaviour marked *tested* is covered
by `backend/test/sync-contract.e2e-spec.ts` (real PostgreSQL) unless another
suite is named.

There are two request formats. **Protocol 2** (`"protocol": 2` in the push
body) carries the record revision each change was based on; the server
detects stale writes and keeps conflicts for the owner to resolve
([Protocol 2](#protocol-2-revisions-and-conflicts)). **Protocol 1** (no
`protocol` field: apps released before protocol 2) works as before, with the
protections listed under [Protocol 1](#protocol-1-older-apps). The approved
rules this implements are summarised in
[proposals/sync-conflicts.md](proposals/sync-conflicts.md).

## Protocol 2: revisions and conflicts

### Revisions

- Clients, invoices and invoice items have a `revision` (integer, starts at
  1). The **database** sets it: a trigger (migration 019) adds 1 on every
  update that changes any column other than `revision`/`updated_at`, for
  every write path (REST, sync, payments, scheduled jobs, SQL). A value sent
  by a client is ignored. The trigger also records which columns each
  revision changed (`sync_record_revisions`).
- Pull returns `revision` on every client, invoice and item. A device keeps
  it with its local copy and sends it back as `base_revision` when it edits
  or deletes the record.
- Client timestamps (`updated_at`) never decide anything.

### Push (`"protocol": 2`)

Each change needs a `change_id`. `update` and `delete` of clients, invoices
and items need `base_revision` (>= 1); `create` has none. An `update`
carries **only the fields the user changed**. Each change is processed in
its own transaction, in array order, under a per-record lock (also taken by
conflict resolution) with the record row-locked, so a REST save cannot slip
in between the check and the write.

| Situation | Result | Record |
|---|---|---|
| `base_revision` = current revision | `applied`, new `revision` | updated |
| Older base; the server changed **other** fields since then, and the history proves it | `merged`, new `revision` | only the sent fields updated |
| Older base; a sent field was also changed on the server, or the history cannot prove which fields changed (pruned, or base 0) | `conflict` + `conflict_id` (`stale_edit`) | unchanged |
| Older base on a **sent, overdue or paid** invoice, or an item of one (any change) | `conflict` (`protected_invoice`) | unchanged; never merged |
| Sent values equal the current ones | `applied` (nothing to change) | unchanged |
| Edit or create of a record that is deleted (soft-deleted, or a tombstone exists) | `conflict` (`edit_after_delete`) | stays deleted |
| Delete with an older base of an editable record | `applied` + `conflict_id` (`delete_after_edit`) | deleted; the version it removed can be restored |
| Delete with current base | `applied` | deleted |
| Delete of an already deleted or never existing record | `applied` | none |
| `base_revision` above the current revision | `failed`, `reason: invalid_base_revision` | unchanged |
| `update` of a record that does not exist (no tombstone) | `failed`, `reason: not_found` | none |
| Missing `change_id` / `base_revision` | `failed`, `reason: change_id_required` / `base_revision_required` | none |
| Another user's record or reference, invalid data, a database error | `failed`, `reason: rejected` (one reason for all, so ownership failures stay indistinguishable; clients count it and stop resending after repeated failures) | unchanged |

**Items of sent, overdue or paid invoices.** An item's own revision does not
move when its invoice is sent or paid, so every protocol-2 item change (create,
update, delete) carries `parent_revision`: the invoice's revision as the device
last saw it (for a move, the target invoice's). On a sent, overdue or paid
invoice the change applies only if `parent_revision` equals the invoice's
current revision; otherwise, or when it is missing, it is a
`protected_invoice` conflict. A move into or out of such an invoice is always
a conflict. The invoice rows are row-locked while this is decided, so a
concurrent status change waits.

"Sent or paid" means status `sent`, `overdue` (a sent invoice past its due
date) or `paid`. There is no other server-side restriction on editing
invoices; this release adds none beyond the conflict rules above.

Merges are only allowed when the server can prove which fields changed: the
revision history must contain every revision after the base. Values are
compared after normalising numbers (`"100.00"` = `100`), dates and JSON.

### Replays and retries

- Same `change_id`, same contents (object, type, base, data): the first
  outcome again, with no second write: `duplicate` for an applied or merged
  change, `conflict` with the same `conflict_id` for a conflicted one.
- Same `change_id`, different contents: `failed`, `reason:
  change_id_reused`, nothing written.
- `failed` changes are not recorded as processed: resending retries them.
  `conflict` changes must not be resent; they are resolved through the
  conflicts API.
- Partial batches: every change stands on its own. A change that depends on
  an earlier one in the same batch (an item of a new invoice) fails if that
  one failed or conflicted (`failed`, the invoice is not the user's), and
  succeeds on a retry once the dependency exists.
- Reconnects: resend the whole unacknowledged queue with the same
  `change_id`s; processed changes are answered from their stored outcome.

### Conflicts API (JWT only; API keys get 401)

- `GET /api/v1/sync/conflicts?status=open|all` — the user's conflicts.
- `GET /api/v1/sync/conflicts/:id` — one conflict plus `current` (the record
  now: `revision`, `deleted`, `fields`). Another user's id answers 404.
- `POST /api/v1/sync/conflicts/:id/resolve` `{action, expected_revision}`:
  - `apply_client` (`stale_edit`): write the device's version over the
    current one;
  - `restore` (`edit_after_delete`, `delete_after_edit`): bring the record
    back (plus the device's edits for `edit_after_delete`; a hard-deleted
    item is recreated from the state kept with its tombstone; an invoice
    needs its client to be active);
  - `dismiss` (any): keep the server as it is.
  Checks, in one transaction: the conflict belongs to the user (404) and is
  still open (409; two resolutions cannot both win), the record is still at
  `expected_revision` (409 with `current_revision`), and `apply_client` or
  edits on a sent/overdue/paid invoice are refused (422). A `protected_invoice`
  conflict can only be dismissed; the user then edits the invoice directly.
- Conflicts keep only an allowlist of business fields
  (`backend/src/sync/conflict-fields.ts`), with long text cut to 2,000
  characters and large JSON dropped; never metadata, credentials or payment
  data. Fields left out are listed in `omitted_fields`.

### Pull additions

- `tombstones`: `{object_type, object_id, deleted_at}` of the user's records
  deleted after `since` (clients, invoices, items, attachments). A protocol-2
  client removes them locally.
- `fullResyncRequired`: `since` is older than the retention period
  (`SYNC_RETENTION_DAYS`, default 400 days), so tombstones may be gone; the
  client drops its local data and pulls without `since`.
- `openConflicts`: number of open conflicts.
- Items created or changed after `since` are returned even when their
  invoice is not.
- `lastSyncTimestamp` is taken before the queries, so a row committed during
  the pull is returned again next time rather than skipped.

### Retention

- Tombstones and field history: `SYNC_RETENTION_DAYS` (default 400, minimum
  90). Within it, a deleted id cannot be recreated, by its owner or anyone
  else. After it, a device offline for longer is told to resync fully, but a
  queued create of such an old id could recreate it (documented limit).
- Resolved or dismissed conflicts: `SYNC_CONFLICT_RETENTION_DAYS` (default
  180). Open conflicts are kept until the owner acts.

## Protocol 1 (older apps)

Requests without `"protocol": 2` are processed as before (whichever write is
applied last wins; there is no concurrency guarantee for these apps), except
where that would bypass a protection they cannot honour:

- update or delete of a sent, overdue or paid invoice (or its items), and
  creating an item in, or moving an item into, such an invoice: `failed`,
  `reason: client_upgrade_required`;
- edit or create of a deleted record: `failed`, `reason: record_deleted`
  (no resurrection, including a replayed old create);
- update of a record with an open conflict: `failed`, `reason: open_conflict`;
- `deletedAt`, `revision`, `createdAt` and `updatedAt` are no longer
  writable through sync (an app can no longer un-delete by sending
  `deletedAt: null`).

These apps resend `failed` changes on every sync, so such a change stays in
their queue until the app is updated. Reads (`pull`) are unchanged for them;
they ignore the new fields.

**Cutoff.** `SYNC_LEGACY_WRITE_CUTOFF` (unset by default: never) refuses all
protocol-1 pushes from that date: every change `failed`, `reason:
client_upgrade_required`, plus `notice: client_upgrade_required` and a
message, HTTP 200 so older apps keep working read-only. Recommended: 60 days
after a confirmed release of an app that speaks protocol 2. No date is set
in this repository.

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

- **`updated_at` is ignored** in both protocols. Protocol 2 detects stale
  writes by revision (above). Protocol 1 cannot: whichever write is
  **applied** last wins (*tested*: a change stamped 2000 that arrives after
  one stamped 2099 wins), except for the protections listed for protocol 1.

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

### Protocol-2 client (in the mobile source; no app build released yet)

- Local database version 6: `revision` on cached clients, invoices and
  items; `pending_changes` gains `base_revision`, `status`
  (`pending` | `conflict` | `failed`), `conflict_id`, `last_reason`,
  `attempts`, `parent_id`, `parent_base_revision`, `last_result`,
  `next_attempt_at`; version 6 adds the `sync_held_rows` table. The upgrade from versions 1 to 5 checks existing
  columns, so it is idempotent (tested from a version-2 database on the host
  and in the Android emulator workflow).
- Push body `{protocol: 2, deviceId, changes}`; `change_id` = local row id;
  `base_revision` for update and delete (taken from the local record when the
  change is queued), never for create; an update queued with the previous
  values carries only the changed fields. At most one change per record is
  sent per round (up to 10 rounds per sync); after an `applied` result, later
  queued changes of that record on the same base move to the returned
  revision. After `merged` they keep their base, so the server compares them
  again.
- Results: `applied`/`merged`/`duplicate` mark the row synced and store the
  returned `revision`; `conflict` sets status `conflict` and the
  `conflict_id`, and the row is never resent; `failed` is classified below.
  `client_upgrade_required` (reason or notice) shows "update the app".
- Invoice item changes also carry `parent_revision`: the local revision of
  the item's invoice when the change was queued (the invoice it is created
  in or moved to, else its current one; omitted when unknown). The invoice id
  is kept in `pending_changes.parent_id`. An item change waits while a change
  of its invoice is sent first; after an `applied` or `merged` invoice result,
  queued item changes on the same invoice version move to the returned
  revision. A rebase of a row that was already sent and answered `failed`
  gives it a new `change_id` (the server stored the old revisions with the
  old one, and a failed change was not applied); a row never sent keeps its
  id; a row whose last send got no answer is not rebased (its resend is
  answered from the stored outcome).
- Three outcomes are kept apart and persisted:
  - **conflict**, as above;
  - **permanent rejection**: `failed` with any reason other than
    `retry_later` (`rejected`, `change_id_reused`, `base_revision_required`,
    `invalid_*`, `not_found`, `record_deleted`, `client_upgrade_required`,
    ...): `status` `failed`, not sent again, blocks neither later changes of
    the record nor pull refreshes; the next pull is a full one (no cursor),
    because earlier pulls skipped the record. Listed under "Changes that
    could not be synced" with "Retry" and "Discard this change" (local only,
    confirmed);
  - **temporary**: `failed` with `retry_later`, `failed` without a reason
    (older server), no result for the change, HTTP 5xx, timeouts and network
    errors: the change stays `pending`, `attempts` + 1, `last_reason`, and
    `next_attempt_at` = now + 30 s doubling per attempt, at most 1 h, times a
    random 75-100 %. It is never abandoned. Until `next_attempt_at` it is not
    sent and holds back later changes of the same record; other records'
    changes still go. The state is in SQLite, so it survives a restart.
    Listed under "Waiting to retry" (last error, attempts, next attempt)
    with "Retry now". A success clears `attempts` and `next_attempt_at`.
- No fallback to protocol 1: a `400` on push, or a response without
  `results`, stops the sync, keeps the whole queue and shows "Sync needs a
  server update".
- Pull by cursor (`GET /sync/pull?cursor=&limit=500`): no stored cursor
  (first sync, or an app that synced with `since` before) means a full
  download. Pages are applied as they arrive while `hasMore`; the returned
  cursor is stored only after the last page, so an interrupted pull restarts
  from the previous cursor (re-delivered pages are upserts). `since` and
  `last_sync_timestamp` are no longer used for pulling (the timestamp is
  kept for the "Last synced" label). Each page: stores `revision`; does not
  overwrite a record that has a pending change; applies `tombstones` (an
  invoice also removes its local items and attachments). `fullResyncRequired`
  clears the cached tables (not `pending_changes`, and not rows that still
  have a pending change) and the cursor, then pulls from the start; `400`
  `reason: invalid_cursor` drops the cursor and pulls from the start. Each
  restart happens at most once per pull; at most 1,000 pages per pull.
  `openConflicts` of the last page feeds the Settings badge.
- A pulled server row of a record with a pending change is not lost when
  the cursor moves past it: it is held in `sync_held_rows` (database
  version 6; a newer delivery replaces it) and written locally once the
  record has no pending or conflict change left (after a push outcome,
  Retry/Discard, a conflict resolved here, or a conflict found no longer
  open at the start of a pull), unless the local copy is already at that or
  a newer revision. It is dropped instead when the device's own delete of
  the record was applied (with an invoice's items and attachments), when
  the conflict was resolved with the device's version (`apply_client`,
  `restore`: the next pull delivers the new server version), and by
  tombstones. Local conflicts are checked one by one
  (`GET /sync/conflicts/:id`, at most 50 per pull, oldest first): 404 or
  not open forgets them, any other error keeps them.
- Conflicts screen (Settings > Data & Sync): list and detail from the
  conflicts API, field table (your version | current version, conflicting
  fields highlighted, omitted fields listed), and only the server's
  `allowed_actions`, sent with `expected_revision` = `current.revision`.
  Nothing from the API is cached except the open count.

## Compatibility and rollout

| server \ app | released app (protocol 1) | protocol-2 app |
|---|---|---|
| before migration 019 | as before | pushes `"protocol": 2`, which an old server rejects (400) and applies nothing; the protocol-2 app shows that sync needs a server update (it does not fall back to protocol 1) |
| with migration 019 | as before plus the protocol-1 protections above; reads unchanged | revisions, merges, conflicts, tombstones |
| with `SYNC_LEGACY_WRITE_CUTOFF` passed | read-only; every push answered `client_upgrade_required` | as above |

- Order: **migration 019 → server → app release → (later, optionally) the
  cutoff.** The server reads the new columns on every client, invoice and
  item query: do not start it without migration 019. Migration 018 must
  already be applied.
- Migration 019 (`backend/migrations/019_sync_revisions_conflicts.sql`) is
  additive and idempotent: `revision` columns (existing rows start at 1),
  `sync_record_revisions`, `sync_tombstones`, `sync_conflicts`, three columns
  on `device_changes`, and the trigger functions and triggers. It changes no
  existing values. Records deleted before it have no tombstone. Run it with
  `psql -v ON_ERROR_STOP=1 --single-transaction`.
- The server checks the live database for the triggers when it starts (not
  the integrity report's fingerprint). Without them, sync pushes and conflict
  resolution answer 503 instead of processing writes without revision
  evidence. With `DB_SYNCHRONIZE=true` (tests, local development only) the
  server installs them itself.
- Rollback: the previous server version ignores the new columns and tables.
  Remove the triggers only together with the columns' users; while the
  triggers stay, they keep revisions and tombstones current. A protocol-2 app
  needs a protocol-2 server.
- Migration 018 remains required (`device_changes.change_id`).

## Known gaps

1. **Protocol-1 apps** have no concurrency guarantee: their writes are last
   applied wins, except for the protections above. This ends only when they
   update.
2. **REST writes** take the row lock but send no revision: a web or REST
   edit always applies to the current record (and bumps its revision, so a
   device's older edit then conflicts or merges).
3. **Attachments** have no revision: they are created and deleted, and
   deletes propagate as tombstones, but an attachment edit is applied as
   sent.
4. **Retention:** after `SYNC_RETENTION_DAYS`, tombstones and field history
   are pruned; a device offline for longer gets `fullResyncRequired`, and a
   queued create of a pruned id could recreate it.
5. **No batch size limit** on `changes`.
6. **Records deleted before migration 019** have no tombstone; devices learn
   about them only on a full resync.
7. **REST invoice edits replace all items** (delete and recreate), so a
   device's offline edit of one of those items becomes an
   `edit_after_delete` conflict; restoring it can duplicate a line, and
   invoice totals are not recalculated by sync or by a restore.
8. **Pull uses server timestamps** (`updatedAt > since`). A write that commits
   just after a pull, with a timestamp before `lastSyncTimestamp`, is missed
   until a later change touches the record or a full resync.
9. **The startup check** confirms the trigger names exist, not the bodies of
   the trigger functions; a hand-edited function would not be detected.
10. **Items removed by hard-deleting an invoice row** get no tombstone of
    their own; devices remove them together with the invoice's tombstone.
