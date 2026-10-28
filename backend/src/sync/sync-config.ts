/**
 * Sync settings (backend/env.example, docs/SYNC-CONTRACT.md). Read once at
 * startup; an invalid value stops the server instead of being ignored.
 *
 * SYNC_LEGACY_WRITE_CUTOFF   Date (YYYY-MM-DD, UTC midnight) or ISO timestamp
 *                            after which pushes from clients that do not
 *                            speak protocol 2 are refused (reads stay open).
 *                            Unset (default): never refused. Set it only after
 *                            a protocol-2 app release is confirmed; the
 *                            recommendation is 60 days after that release.
 * SYNC_RETENTION_DAYS        How long deletion tombstones and field-change
 *                            history are kept (default 400, minimum 90). A
 *                            device that last synced earlier must resync fully.
 * SYNC_CONFLICT_RETENTION_DAYS
 *                            How long resolved or dismissed conflicts are kept
 *                            (default 180, minimum 7). Open conflicts are kept
 *                            until the owner resolves or dismisses them.
 */
export interface SyncConfig {
  legacyWriteCutoff: Date | null;
  retentionDays: number;
  conflictRetentionDays: number;
}

export const SYNC_CONFIG = Symbol('SYNC_CONFIG');

function days(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim()) || Number(raw) < minimum) {
    throw new Error(`${name} must be a whole number of days, at least ${minimum} (got "${raw}")`);
  }
  return Number(raw);
}

export function readSyncConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig {
  let legacyWriteCutoff: Date | null = null;
  const cutoff = env.SYNC_LEGACY_WRITE_CUTOFF?.trim();
  if (cutoff) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(cutoff) ? new Date(`${cutoff}T00:00:00Z`) : new Date(cutoff);
    if (isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(cutoff)) {
      throw new Error(`SYNC_LEGACY_WRITE_CUTOFF must be a date (YYYY-MM-DD) or an ISO 8601 timestamp (got "${cutoff}")`);
    }
    legacyWriteCutoff = parsed;
  }
  return {
    legacyWriteCutoff,
    retentionDays: days(env, 'SYNC_RETENTION_DAYS', 400, 90),
    conflictRetentionDays: days(env, 'SYNC_CONFLICT_RETENTION_DAYS', 180, 7),
  };
}
