# Proposal: conflict handling for offline sync

Status: **proposal, not implemented.** Nothing here changes behaviour until
the owner has made the decisions in [Decisions](#decisions-for-the-owner).
Current behaviour is in [../SYNC-CONTRACT.md](../SYNC-CONTRACT.md).

## Minimum decisions (summary, 2026-10-28)

Only three choices change what users see; the owner must answer them. The
rest have recommended defaults that apply once these three are answered.
Already merged and unaffected: per-user replay protection (`change_id`),
per-change results, per-object locking, and the ownership checks.

**Q1. Two devices edit the same record (D1, D2).** Which version wins?
- **(a) Recommended.** For an invoice that is no longer a draft (`sent`,
  `paid`, `cancelled`), the offline edit is refused and the user sees "changed
  on another device" with both versions to choose from. For drafts, clients
  and items, fields edited on only one side are merged; for the same field the
  later edit wins and the overwritten value is kept in the history.
- (b) The later edit always wins (today's behaviour), but the overwritten
  version is kept in the history so it can be restored.
- (c) Always refuse and ask the user.

**Q2. Edit and delete cross (D3).**
- **(a) Recommended.** An edit to a record deleted elsewhere is discarded and
  the user is told. A delete wins over an earlier remote edit. A device can no
  longer un-delete through sync; restoring is a separate, explicit action.
- (b) The edit brings the deleted record back.
- (c) Ask the user each time.

**Q3. Old app versions (D6).** After the mobile release, how long should
unversioned writes from older apps be accepted (stale overwrites stay possible
from those apps)?
- **(a) Recommended.** Until a date you choose (for example 60 days after the
  release), then those apps must update before they can sync.
- (b) Indefinitely.

Recommended defaults for the rest:

| | Default | User-visible effect |
|---|---|---|
| D4 | A conflict response carries the full current record | The app can show both versions without another request |
| D5 | Reason codes (validation, missing reference, retry later); the app shows a change that failed 3 times instead of retrying forever | A stuck change appears in a list the user can fix or discard |
| D7 | REST/web edits take the same lock and accept an optional revision | Web edits get the same conflict handling; none without a revision |
| D8 | Keep today's behaviour for old clients (implemented) | None |
| D9 | Wait for the mobile release instead of deriving keys for old clients | None; replays from old apps stay possible until they update |
| D10 | Deletes propagate on pull as tombstones (needed for Q2) | Records deleted on one device disappear from the others |

## Problem

The server applies a sync change to whatever the record looks like when the
change arrives. It ignores the device's `updated_at` and compares no version.
So:

- A device that was offline for a week overwrites newer edits from another
  device, or from the web/REST API, with older data. Nobody is told.
- An edit made offline to a record that someone else deleted is applied to
  the deleted row and stays invisible. For clients and invoices it is a soft
  delete, and the device can even un-delete the row by sending
  `deletedAt: null`.
- Invoices have legal and financial meaning (sent, paid, numbered). A stale
  edit can change the amounts of an invoice that has already been sent or
  paid elsewhere.

What this branch already fixed, and what does not need this proposal:
replays of the *same* change (`change_id`), exact per-change acknowledgements
(`results`), lost updates between concurrent pushes (per-object lock), and
failed changes being acknowledged. Those are delivery problems. This proposal
is about **concurrent edits made from different starting points**, which is a
business-semantics question.

## Why this is not implemented now

Detecting a stale edit requires the device to say **which server state it
edited** (a base revision). The released client does not track that, so any
real fix needs:

1. a schema change (a per-record revision the server controls),
2. a protocol change (the client sends `base_version`, the server answers
   `conflict`), and
3. a coordinated mobile release that stores revisions and handles conflicts
   in the UI.

The intended outcome of a conflict (reject? keep the server's version? keep
the device's? merge fields?) is not defined anywhere in the existing
requirements, so it must not be chosen silently.

Using the device's clock (`updated_at`) as authority is ruled out. Device
clocks are wrong or adjustable, the released client stamps the *queue* time,
and that would make a device with a clock in 2099 win every conflict.

## Proposed design (recommended option)

### Server revision per record

- Migration `019_add_sync_revision.sql`: add
  `revision bigint NOT NULL DEFAULT 1` to `clients`, `invoices`,
  `invoice_items` and `attachments`. With a constant default this is a
  metadata-only change in PostgreSQL 11+, with no table rewrite. Add
  `updated_at` to `invoice_items` and `attachments` too (needed for pull, gap
  4).
- Bump `revision` in a `BEFORE UPDATE` trigger (`NEW.revision :=
  OLD.revision + 1`). Use a trigger, not TypeORM `@VersionColumn`, because
  several write paths use `repository.update()` or query builders, which do
  not bump a version column: `invoice-status.service.ts`,
  `clients.service.ts` bulk update, `gdpr.service.ts`. A trigger covers REST,
  sync, jobs and manual SQL alike.
- Pull returns `revision` with every record.

### Protocol (additive)

- A change may carry `base_revision` (the revision the device last saw for
  that record). `create` carries none.
- If `base_revision` is present and differs from the current revision, the
  change is **not applied**. The result entry gets `status: "conflict"`, plus
  `server_revision` and, if decision D4 says so, the current server record.
- If `base_revision` is absent, today's behaviour applies (apply in arrival
  order), unless decision D6 retires it.
- Deletes carry `base_revision` too. A record that was deleted after the
  base revision is answered `conflict` (or per D3).
- `conflict` is a new status value. Clients that only know `applied`,
  `duplicate` and `failed` must treat unknown statuses as "not applied, keep
  pending". The client commit on this branch already does that: it marks
  only `applied`/`duplicate`.

### Client (mobile release)

- Store `revision` per local row from pull, and send it as `base_revision`
  when queueing an update or delete.
- On `conflict`: what to do depends on D1 and D4 (show both versions, keep
  the server's, re-base and resend).

### Alternatives considered

| option | schema | client release | outcome | notes |
|--------|--------|----------------|---------|-------|
| A. Server revision + `base_revision` (recommended) | yes | yes | stale edits detected exactly | needs D1–D6 |
| B. `base_updated_at` using existing `updatedAt` | no for clients/invoices | yes | detection, with caveats | `updatedAt` comes from two clocks (API on sync updates, DB on inserts/REST) and millisecond precision through JSON; items/attachments have no `updatedAt`. Would first need `updatedAt` set by the database everywhere. |
| C. Server-side last-write-wins by server receive time | no | no | this is today's behaviour | not conflict handling, documents the status quo |
| D. Field-level merge (device sends changed fields and their base values) | no or yes | yes | fewer user-visible conflicts | more complex; still needs a rule for the same field edited twice |
| E. Device timestamp LWW | no | no | ruled out | client clocks are not authority |

## Migration and compatibility plan

1. **Server release N** (no behaviour change for existing clients): migration
   019 adds the revision column and trigger, pull returns `revision`, push
   accepts optional `base_revision`, and the `conflict` status exists.
   Changes without `base_revision` behave exactly as today.
2. **Mobile release M** (after N is deployed everywhere): store revisions,
   send `base_revision` and `change_id`, handle `conflict`. As with
   `change_id`, an older server rejects the unknown field with `400`
   (`forbidNonWhitelisted`), so the server ships first.
3. **Optional later server release** (only if D6 decides so): reject
   unversioned updates and deletes from clients older than M, for example
   with `426 Upgrade Required` and a minimum app version.

Rollback: release N can be rolled back while the column and trigger stay
(the old server ignores them). Release M must then be held back.

Tests needed for the implementation: stale update → `conflict` and record
unchanged; matching base → applied and revision +1; REST edit between device
read and push → `conflict`; delete-vs-edit both ways; concurrent pushes with
the same base → exactly one applied; unversioned change from an old client →
today's behaviour (or 426 per D6); trigger bumps on `repository.update()`
paths; ownership suites unchanged.

## Decisions for the owner

- **D1. Conflict policy.** When a device edits a record that changed on the
  server since the device last saw it, what should happen? Options: reject
  and ask the user; keep the server version silently; keep the device version
  but record the overwritten one; merge fields that do not overlap.
- **D2. Scope and protected states.** Does the policy differ per entity or
  per invoice status? For example, should offline edits to an invoice that is
  `sent`/`paid` elsewhere ever be applied?
- **D3. Delete vs edit.** Edit after a remote delete: discard the edit,
  resurrect the record, or ask? Delete after a remote edit: delete anyway or
  ask? Should a device be able to un-delete by sending `deletedAt: null` (it
  can today)?
- **D4. What a conflict response contains.** Only `server_revision`, or the
  full current record? The full record lets the client show both versions in
  one round trip.
- **D5. Permanently failing changes.** Today a change that can never succeed
  (bad data, a reference to a record that is gone) is reported `failed` on
  every sync forever. Should the server return reason codes that are not
  ownership-related (validation vs. missing reference vs. transient)? Should
  the client drop changes after N attempts, or surface them to the user?
- **D6. Old clients after the mobile release.** Keep accepting unversioned
  writes indefinitely (stale overwrites stay possible from old apps), or set
  a minimum app version and reject them from a certain date?
- **D7. REST/web edits.** Should REST updates also take the per-object sync
  lock and accept an optional `If-Match`/revision, so web and sync conflicts
  are handled the same way?
- **D8. Old clients' acknowledgement problem (now).** Old clients mark the
  first `synced` changes. The server could make that count truthful by
  stopping a batch at the first failure (the rest reported `failed`, never
  applied). That trades the current silent loss of one failed change for
  **head-of-line blocking**: one permanently bad change would stop all later
  changes from that device. Keep today's behaviour (implemented), or switch
  for requests without `change_id`?
- **D9. Replay protection for old clients (now).** Requests without
  `change_id` could get a derived idempotency key (user, `device_id`,
  `object_type`, `object_id`, `change_type`, `updated_at`; the released
  client stamps `updated_at` with the queue time, microseconds on the Dart VM). This would make
  replays from released apps no-ops, at the cost of treating two genuinely
  separate identical changes in the same microsecond as one. Adopt, or wait
  for the mobile release?
- **D10. Delete propagation (pull).** Tombstones or a deleted-ids list, so
  other devices learn about deletes (contract gap 3). This interacts with D3.
