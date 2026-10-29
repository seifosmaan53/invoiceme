import { BadRequestException } from '@nestjs/common';

/**
 * Opaque pull cursor (docs/SYNC-CONTRACT.md "Delivery guarantee").
 *
 * Between pulls it holds `snap`: the PostgreSQL snapshot (pg_current_snapshot)
 * the last complete pull read up to. The next pull returns every row whose
 * change_txid is NOT visible in `snap` (changed by a transaction that had not
 * committed when that pull started) and IS visible in a new snapshot `upto`.
 * A transaction still running at `upto` is picked up by the following pull,
 * so every committed change is delivered by some pull, whatever its
 * timestamps.
 *
 * While paging it holds `from`/`upto` (fixed for all pages of one pull) and
 * the position: record type index `t` and the last id delivered `after`.
 */
export interface PullCursor {
  v: 1;
  /** Complete-pull cursor: the snapshot already delivered. */
  snap?: string;
  /** Page cursor: the snapshot delivered before this pull (null = from the start)... */
  from?: string | null;
  /** ...and the snapshot this pull reads up to. */
  upto?: string;
  /** Record type index and last id within it. */
  t?: number;
  after?: string | null;
  /** When the pull that produced `snap` (or this page) started. */
  issued: string;
}

/** pg_snapshot text form: xmin:xmax:xip,xip,... */
const SNAPSHOT = /^\d{1,20}:\d{1,20}:(\d{1,20}(,\d{1,20})*)?$/;
/** Record key: an id, or object_type:object_id for tombstones. */
const KEY = /^[a-z_]{0,20}:?[0-9a-f-]{1,64}$/i;

function invalid(): never {
  throw new BadRequestException({ message: 'Invalid sync cursor; pull again without it', reason: 'invalid_cursor' });
}

export function encodeCursor(cursor: PullCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(token: string): PullCursor {
  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    invalid();
  }
  if (!parsed || parsed.v !== 1 || typeof parsed.issued !== 'string' || isNaN(Date.parse(parsed.issued))) invalid();
  const snapshotOk = (value: unknown, nullable: boolean) =>
    (nullable && value === null) || (typeof value === 'string' && SNAPSHOT.test(value));
  if (parsed.upto !== undefined) {
    if (!snapshotOk(parsed.upto, false) || !snapshotOk(parsed.from, true)) invalid();
    if (!Number.isInteger(parsed.t) || parsed.t < 0 || parsed.t > 4) invalid();
    if (parsed.after !== null && !(typeof parsed.after === 'string' && KEY.test(parsed.after))) invalid();
  } else if (!snapshotOk(parsed.snap, false)) {
    invalid();
  }
  return parsed as PullCursor;
}
