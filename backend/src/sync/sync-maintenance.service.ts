import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { SYNC_CONFIG, SyncConfig } from './sync-config';

/**
 * Daily retention for sync bookkeeping (docs/SYNC-CONTRACT.md):
 * - tombstones and field-change history older than SYNC_RETENTION_DAYS (a
 *   device that last synced before that is told to resync fully);
 * - resolved or dismissed conflicts older than SYNC_CONFLICT_RETENTION_DAYS.
 * Open conflicts are never removed by retention.
 */
@Injectable()
export class SyncMaintenanceService {
  private readonly logger = new Logger(SyncMaintenanceService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(SYNC_CONFIG) private readonly config: SyncConfig,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(now = new Date()): Promise<{ tombstones: number; revisions: number; conflicts: number }> {
    const horizon = new Date(now.getTime() - this.config.retentionDays * 86_400_000);
    const conflictHorizon = new Date(now.getTime() - this.config.conflictRetentionDays * 86_400_000);
    const [, tombstones] = await this.dataSource.query('DELETE FROM sync_tombstones WHERE deleted_at < $1', [horizon]);
    const [, revisions] = await this.dataSource.query('DELETE FROM sync_record_revisions WHERE created_at < $1', [horizon]);
    const [, conflicts] = await this.dataSource.query(
      `DELETE FROM sync_conflicts WHERE status IN ('resolved', 'dismissed') AND resolved_at < $1`,
      [conflictHorizon],
    );
    const result = { tombstones, revisions, conflicts };
    if (tombstones || revisions || conflicts) this.logger.log(`Sync retention removed ${JSON.stringify(result)}`);
    return result;
  }
}
